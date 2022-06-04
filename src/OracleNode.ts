import * as BLS from "./BLS";
import { ethers } from "ethers";
import { range } from "lodash";
import { Messenger, Messenger__factory, Oracle, Oracle__factory } from "../typechain";
import { AggregationTopic, Aggregator, SignatureResolver } from "./Aggregator";
import { getAggregationNodeFromSolidityNode, PrivateNode, AggregationNode, OracleState } from "./common";
import { Fr, PointG1, PointG2 } from "./EC/bn128";
import { arrayify, solidityPack } from "ethers/lib/utils";

class OracleNodeSignatureResolverError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OracleNodeSignatureResolverError";
    }
}

export interface OracleNodeConfig {
    node: PrivateNode;
    port: number;

    rpcURLSrc: string;
    rpcURLDst: string;

    pollingIntervalSrc: number; // in ms,
    pollingIntervalDst: number; // in ms,

    AGGREGATION_REQUEST_TIMEOUT: number;
    AGGREGATION_SYNC_DELTA_IN_SECONDS: number;

    MESSENGER_SRC_CONTRACT_ADDRESS: string;
    ORACLE_DST_CONTRACT_ADDRESS: string;

    // loadOracleState: () => Promise<{
    //     aggregationSK: Fr;
    //     aggregationPKs: Record<string, PointG2>;
    //     aggregationIndices: Record<string, number>;
    // }>;
    loadOracleState: () => Promise<OracleState | null>;
}

export class OracleNode {
    MessengerContractSrc: Messenger;
    OracleContractDst: Oracle;
    aggregator: Aggregator | undefined = undefined;
    config: OracleNodeConfig;

    constructor(config: OracleNodeConfig) {
        this.config = config;
        const provider_src = new ethers.providers.JsonRpcProvider(config.rpcURLSrc);
        const provider_dst = new ethers.providers.JsonRpcProvider(config.rpcURLDst);
        provider_src.pollingInterval = config.pollingIntervalSrc;
        provider_dst.pollingInterval = config.pollingIntervalDst;
        const wallet_dst = new ethers.Wallet(config.node.ethPrivateKey, provider_dst);
        this.MessengerContractSrc = Messenger__factory.connect(config.MESSENGER_SRC_CONTRACT_ADDRESS, provider_src);
        this.OracleContractDst = Oracle__factory.connect(config.ORACLE_DST_CONTRACT_ADDRESS, wallet_dst);
    }

    async init(): Promise<void> {
        const oracleState = await this.config.loadOracleState();
        if (!oracleState) throw new Error("!oracleState");
        const { aggregationSK, aggregationPKs, aggregationIndices } = oracleState;
        const nRegistered = (await this.OracleContractDst.size()).toNumber();
        const nodes: AggregationNode[] = await Promise.all(
            range(nRegistered).map(async (index) => {
                const { node, account } = await this.OracleContractDst.getFullNodeByIndex(index);
                return getAggregationNodeFromSolidityNode(
                    node,
                    account,
                    index,
                    aggregationPKs[account],
                    aggregationIndices[account]
                );
            })
        );

        const signatureResolver: SignatureResolver = async (blocknumberSrc, topic) => {
            try {
                if (topic !== AggregationTopic.ROOT) {
                    throw new OracleNodeSignatureResolverError("topic !== AggregationTopic.ROOT");
                }
                const lastRootBlockNumber = (await this.OracleContractDst.oracleRootBlockNumber()).toNumber();

                if (blocknumberSrc <= lastRootBlockNumber) {
                    throw new OracleNodeSignatureResolverError("aggregationId <= lastOriginRootBlockNumber");
                }
                const root = await this.MessengerContractSrc.root({ blockTag: blocknumberSrc });
                const message = solidityPack(["bytes32", "uint"], [root, blocknumberSrc]);
                const signature = BLS.Sign(aggregationSK, arrayify(message));
                return { message, signature, error: null };
            } catch (err) {
                if (err instanceof OracleNodeSignatureResolverError) {
                    return { message: "", signature: PointG1.zero(), error: err.message };
                } else {
                    throw err;
                }
            }
        };

        this.aggregator = new Aggregator({
            port: this.config.port,
            nodes,
            aggregationSK,
            signatureResolver,
            AGGREGATION_REQUEST_TIMEOUT: this.config.AGGREGATION_REQUEST_TIMEOUT,
            AGGREGATION_SYNC_DELTA_IN_SECONDS: this.config.AGGREGATION_SYNC_DELTA_IN_SECONDS,
        });
    }

    listenAndHandleOracleRoots(): void {
        const aggregator = this.aggregator;
        if (!aggregator) throw new Error("Please call OracleNode.init()");
        let lastAggregatorNode: AggregationNode | null = null;

        this.OracleContractDst.provider.on("block", async (blocknumberDst) => {
            // console.log("listened to blocknumber", blocknumberDst);

            const isGenerating = await this.OracleContractDst.isGenerating();
            if (isGenerating) return;

            const newAggregatorNode = await this.getNextAggregatorNode(aggregator, blocknumberDst);

            if (newAggregatorNode === null) {
                // set to idle state and wait until next epoch
                if (aggregator.isServerRunning) {
                    await aggregator.stopAggregationServer();
                }
                lastAggregatorNode = null;
                return;
            }

            if (lastAggregatorNode === null) {
                // just started listening OR this node is waking up from idle state
                await aggregator.startAggregationServer(newAggregatorNode);
                lastAggregatorNode = newAggregatorNode;
            } else if (lastAggregatorNode.ethAccount !== newAggregatorNode.ethAccount) {
                // new epoch AND new aggregator: restart server
                await aggregator.stopAggregationServer();
                await aggregator.startAggregationServer(newAggregatorNode);
                lastAggregatorNode = newAggregatorNode;
            }

            if (newAggregatorNode.ethAccount === this.config.node.ethAccount) {
                // console.log("I am the aggregator for blocknumber", blocknumberDst);
                // this node is the aggregator
                const blocknumberSrc = await this.MessengerContractSrc.provider.getBlockNumber();
                const root = await this.MessengerContractSrc.root({ blockTag: blocknumberSrc });
                const message = solidityPack(["bytes32", "uint256"], [root, blocknumberSrc]);

                const signatureMap = await aggregator.runAggregation(blocknumberSrc, message, AggregationTopic.ROOT);

                const thresholdSig = await this.calculateThresholdSignature(signatureMap, aggregator);
                if (!thresholdSig) return;

                // submit signatures
                const MPK = await this.getMPK();
                const isOracleThresholdSigValid = BLS.Verify(MPK, arrayify(message), thresholdSig);
                console.log({ isOracleThresholdSigValid });

                await this.OracleContractDst.updateRoot(thresholdSig.toBigInts(), root, blocknumberSrc);
                console.log("=== Oracle root submission successful ===");
            }
        });
    }

    async stopListening(): Promise<void> {
        this.OracleContractDst.provider.removeAllListeners();
        await this.aggregator?.stopAggregationServer();
    }

    private async calculateThresholdSignature(
        signaturesMap: Record<number, PointG1 | null>,
        aggregator: Aggregator
    ): Promise<PointG1 | null> {
        const signatures: PointG1[] = [];
        const xPoints: Fr[] = [];
        for (const index of Object.keys(signaturesMap).map(Number)) {
            const signature = signaturesMap[index];
            if (signature === null) continue;
            const node = aggregator.nodes.find((node) => node.index === index);
            if (!node) throw new Error("!node");
            const xPoint = new Fr(node.aggregationIndex + 1);
            signatures.push(signature);
            xPoints.push(xPoint);
        }

        const threshold = (await this.OracleContractDst.getThreshold(aggregator.nodes.length)).toNumber();

        if (signatures.length < threshold + 1) {
            console.warn("Could not gather at least t + 1 threshold signatures");
            return null;
        }

        const thresholdSig = BLS.AggregateThresholdSignatures(
            signatures.slice(0, threshold + 1),
            xPoints.slice(0, threshold + 1)
        );

        return thresholdSig;
    }

    private async getNextAggregatorNode(
        aggregator: Aggregator,
        currentBlockNumber: number
    ): Promise<AggregationNode | null> {
        const nextEpoch = await this.OracleContractDst.getEpoch(currentBlockNumber + 1);
        const lastEpoch = await this.OracleContractDst.lastEpoch();
        if (nextEpoch.eq(lastEpoch)) return null;
        const nextAggregatorIndex = await this.OracleContractDst.getAggregatorIndex(nextEpoch);
        const nextAggregatorNode = aggregator.nodes.find((node) => node.index === nextAggregatorIndex.toNumber());
        if (nextAggregatorNode === undefined) {
            throw new Error("nextAggregatorNode === undefined, should never happen");
        }
        return nextAggregatorNode;
    }

    private async getMPK(): Promise<PointG2> {
        const mpkBigInts = await Promise.all(
            range(4).map(async (i) => {
                return (await this.OracleContractDst.masterPublicKey(i)).toBigInt();
            })
        );
        return new PointG2().fromBigInts(mpkBigInts as [bigint, bigint, bigint, bigint]);
    }
}
