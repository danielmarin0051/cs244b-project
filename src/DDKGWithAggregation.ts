import { ethers } from "ethers";
import EventEmitter from "events";
import { range } from "lodash";
import { DKG, DKG__factory } from "../typechain";
import { AggregationTopic, Aggregator, SignatureResolver } from "./Aggregator";
import { AggregationNode, PrivateNode, Node, getNodeFromSolidityNode, OracleState } from "./common";
import { DDKGNode } from "./DDKGNode";
import { Fr, PointG1, PointG2 } from "./EC/bn128";
import * as BLS from "./BLS";
import { arrayify, solidityPack } from "ethers/lib/utils";
import { logger } from "./logger";

export type DDKGWithAggregationConfig = {
    node: PrivateNode;

    port: number;

    rpcURLDst: string;
    rpcURLBroadcast: string;

    pollingIntervalDst: number; // in ms
    pollingIntervalBroadcast: number; // in ms

    DKG_CONTRACT_ADDRESS: string;
    BROADCAST_CONTRACT_ADDRESS: string;

    DKG_REQUEST_TIMEOUT: number;
    DKG_SYNC_DELTA_IN_SECONDS: number;
    AGGREGATION_REQUEST_TIMEOUT: number;
    AGGREGATION_SYNC_DELTA_IN_SECONDS: number;
    BROADCAST_SYNC_DELTA_IN_BLOCKS: number;

    saveOracleState: (state: OracleState) => Promise<void>;
    loadOracleState: () => Promise<OracleState | null>;
};

const LOG_TOPIC = "DDKGWithAggregation";

export class DDKGWithAggregation {
    config: DDKGWithAggregationConfig;
    private DKG: DKG;
    private emitter = new EventEmitter();

    constructor(config: DDKGWithAggregationConfig) {
        this.config = config;
        const providerDst = new ethers.providers.JsonRpcProvider(config.rpcURLDst);
        providerDst.pollingInterval = config.pollingIntervalDst;
        this.DKG = DKG__factory.connect(
            config.DKG_CONTRACT_ADDRESS,
            new ethers.Wallet(config.node.ethPrivateKey, providerDst)
        );
    }

    static events = {
        DKGInitiated: "DKGInitiated",
        DKGCompleted: "DKGCompleted",
    };

    on(event: string, listener: () => void): void {
        this.emitter.on(event, listener);
    }

    removeAllListeners(): void {
        this.emitter.removeAllListeners();
    }

    stopListeningToAllEvents(): void {
        this.DKG.removeAllListeners();
    }

    listenAndHandleDKGWithAggregation(): void {
        logger.info(`${LOG_TOPIC}: Listening contract for DKGInitiated event`);
        this.DKG.on(this.DKG.filters.DKGInitiated(), async (sessionIdBN) => {
            logger.info(`${LOG_TOPIC}: Listened to DKGInitiated event, sessionId: ${sessionIdBN.toString()}`);
            this.emitter.emit(DDKGWithAggregation.events.DKGInitiated);

            const sessionId = sessionIdBN.toNumber();
            const oracleState = await this.config.loadOracleState();
            this.config.node.aggregationSK = oracleState?.aggregationSK ?? null;
            this.config.node.aggregationIndex = oracleState?.aggregationIndices[this.config.node.ethAccount] ?? null;
            this.config.node.aggregationPK = oracleState?.aggregationPKs[this.config.node.ethAccount] ?? null;

            {
                const { aggregationSK, aggregationPK, aggregationIndex } = this.config.node;
                logger.info(
                    `${LOG_TOPIC}: Loaded oracle state aggregationSK: ${aggregationSK}, aggregationPK: ${aggregationPK}, aggregationIndex: ${aggregationIndex}`
                );
            }

            const nRegistered = (await this.DKG.size()).toNumber();
            const nWaitlist = (await this.DKG.waitlistSize()).toNumber();
            const newThreshold = (await this.DKG.getThreshold(nRegistered + nWaitlist)).toNumber();
            const registeredNodes: Node[] = await Promise.all(
                range(nRegistered).map(async (index) => {
                    const { node, account } = await this.DKG.getFullNodeByIndex(index);
                    return getNodeFromSolidityNode(
                        node,
                        account,
                        index,
                        oracleState ? oracleState.aggregationPKs[account] : null,
                        oracleState ? oracleState.aggregationIndices[account] : null
                    );
                })
            );
            const waitlistNodes: Node[] = await Promise.all(
                range(nWaitlist).map(async (index) => {
                    const { node, account } = await this.DKG.getFullWaitlistNodeByIndex(index);
                    return getNodeFromSolidityNode(node, account, nRegistered + index, null, null);
                })
            );
            const dkg = await this.runDKGWithAggregation(sessionId, newThreshold, registeredNodes, waitlistNodes);
            const { aggregationSK, aggregationPKs, aggregationIndices } = dkg.getAggregationData();
            await this.config.saveOracleState({ aggregationSK, aggregationPKs, aggregationIndices });

            this.emitter.emit(DDKGWithAggregation.events.DKGCompleted);
            console.log(`Node ${this.config.node.ethAccount} exiting`);
        });
    }

    async runDKGWithAggregation(
        sessionId: number,
        threshold: number,
        registeredNodes: Node[],
        waitlistNodes: Node[]
    ): Promise<DDKGNode> {
        logger.info(
            `${LOG_TOPIC}: runDKGWithAgregation() with sessionId: ${sessionId}, threshold: ${threshold}, nRegistered: ${registeredNodes.length}, nWaitlist: ${waitlistNodes.length}`
        );
        const nodes = [...registeredNodes, ...waitlistNodes];
        const dkg = await this.runDKG(sessionId, threshold, nodes);

        const iAmInWaitlist = Boolean(waitlistNodes.find((node) => node.ethAccount === this.config.node.ethAccount));
        if (!iAmInWaitlist) {
            const registeredQUALNodes = registeredNodes.filter((node) => dkg.dkg.QUAL.has(node.index));
            const disqualified = Array.from(dkg.dkg.disqualified)
                .sort((a, b) => a - b)
                .map((index) => nodes[index].ethAccount);
            const MPK = dkg.dkg.mpk;
            const message = solidityPack(
                ["uint256[4]", "address[]", "uint256"],
                [MPK.toBigInts(), disqualified, sessionId]
            );
            const oldThreshold = (await this.DKG.getThreshold(registeredNodes.length)).toNumber();
            await this.runAggregation(sessionId, registeredQUALNodes, message, MPK, disqualified, oldThreshold);
        } else {
            await this.waitUntilDKGIsCompleted(sessionId);
        }
        return dkg;
    }

    async runDKG(sessionId: number, threshold: number, nodes: Node[]) {
        const n = nodes.length;
        const t = threshold;
        const selfPublicNode = nodes.find((node) => node.ethAccount === this.config.node.ethAccount);
        if (selfPublicNode === undefined) throw new Error();
        const dkg = new DDKGNode({
            n,
            t,
            nodes,
            sessionId,

            sk: this.config.node.sk,
            ethPrivateKey: this.config.node.ethPrivateKey,
            selfNode: selfPublicNode,

            port: this.config.port,
            rpcURLBroadcast: this.config.rpcURLBroadcast,

            BROADCAST_CONTRACT_ADDRESS: this.config.BROADCAST_CONTRACT_ADDRESS,

            DKG_REQUEST_TIMEOUT: this.config.DKG_REQUEST_TIMEOUT,
            DKG_SYNC_DELTA_IN_SECONDS: this.config.DKG_SYNC_DELTA_IN_SECONDS,
            BROADCAST_SYNC_DELTA_IN_BLOCKS: this.config.BROADCAST_SYNC_DELTA_IN_BLOCKS,
        });
        console.log(`${LOG_TOPIC}: SelfNode ${selfPublicNode.index} initiating DKG`);
        await dkg.runDDKG();
        console.log(`${LOG_TOPIC}: SelfNode ${selfPublicNode.index} completed DKG`);
        return dkg;
    }

    async runAggregation(
        sessionId: number,
        nodes: Node[],
        message: string,
        MPK: PointG2,
        disqualified: string[],
        oldThreshold: number
    ): Promise<void> {
        const { aggregationSK, aggregationIndex, aggregationPK } = this.config.node;
        if (aggregationSK === null) {
            throw new Error("aggregationSK === null && !iAmInWaitlist");
        }
        if (aggregationIndex === null) {
            throw new Error("aggregationIndex === null && !iAmInWaitlist");
        }
        if (aggregationPK === null) {
            throw new Error("aggregationPK === null && !iAmInWaitlist");
        }
        console.log(`${LOG_TOPIC}: SelfNode ${aggregationIndex} running aggregation`);

        // For TypeScript
        const aggregationNodes: AggregationNode[] = nodes.map((node) => {
            if (node.aggregationPK === null) throw new Error();
            if (node.aggregationIndex === null) throw new Error();
            return { ...node, aggregationPK: node.aggregationPK, aggregationIndex: node.aggregationIndex };
        });

        const signatureResolver: SignatureResolver = async (aggregationId, topic) => {
            let error: string | null = null;
            if (aggregationId !== sessionId) error = "aggregationId !== sessionId";
            else if (topic !== AggregationTopic.DKG) error = "topic !== AggregationTopic.DKG";
            if (error === null) {
                const signature = BLS.Sign(aggregationSK, arrayify(message));
                return { message, signature, error: null };
            } else {
                return { message: "", signature: PointG1.zero(), error };
            }
        };

        const aggregator = new Aggregator({
            aggregationSK,
            nodes: aggregationNodes,
            port: this.config.port,
            signatureResolver,
            AGGREGATION_SYNC_DELTA_IN_SECONDS: this.config.AGGREGATION_SYNC_DELTA_IN_SECONDS,
            AGGREGATION_REQUEST_TIMEOUT: this.config.AGGREGATION_REQUEST_TIMEOUT,
        });

        const nextBlockNumber = (await this.DKG.provider.getBlockNumber()) + 1;
        const aggregatorIndex = (await this.DKG.getDKGAgregatorIndexByBlock(nextBlockNumber)).toNumber();
        const aggregatorNode = aggregationNodes.find((node) => node.index === aggregatorIndex);

        if (aggregatorNode === undefined) {
            // TODO: Handle me, the aggregatorNode is not in QUAL -intersection- registeredNodes
            throw new Error("aggregatorNode === undefined");
        }

        await aggregator.startAggregationServer(aggregatorNode);

        if (aggregatorNode.ethAccount === this.config.node.ethAccount) {
            await this.runAsAggregator(aggregator, sessionId, message, MPK, disqualified, oldThreshold);
        } else {
            await this.waitUntilDKGIsCompleted(sessionId);
        }

        await aggregator.stopAggregationServer();
    }

    private async runAsAggregator(
        aggregator: Aggregator,
        sessionId: number,
        message: string,
        MPK: PointG2,
        disqualified: string[],
        oldThreshold: number
    ): Promise<void> {
        console.log(`I am the aggregator: ${this.config.node.ethAccount}`);
        const signaturesMap = await aggregator.runAggregation(sessionId, message, AggregationTopic.DKG);
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

        if (signatures.length < oldThreshold + 1) {
            throw new Error(`Aggregator: Could not gather at least ${oldThreshold + 1} signatures`);
        }

        // need t + 1 signatures to recover thresholdSig
        const thresholdSig = BLS.AggregateThresholdSignatures(
            signatures.slice(0, oldThreshold + 1),
            xPoints.slice(0, oldThreshold + 1)
        );

        const oldMPK = await this.getMPK();
        const isDKGThresholdSigValid = BLS.Verify(oldMPK, arrayify(message), thresholdSig);
        console.log({ isDKGThresholdSigValid });
        if (!isDKGThresholdSigValid) throw new Error("!isValid");

        // submit
        await this.DKG.completeDKG(thresholdSig.toBigInts(), MPK.toBigInts(), disqualified, sessionId);
        console.log("=== DKG Key submitted successfully ===");
    }

    private async waitUntilDKGIsCompleted(sessionId: number): Promise<void> {
        await new Promise<void>((resolve) => {
            this.DKG.on(this.DKG.filters.DKGCompleted(sessionId), () => resolve());
        });
    }

    private async getMPK(): Promise<PointG2> {
        const mpkBigInts = await Promise.all(
            range(4).map(async (i) => {
                return (await this.DKG.masterPublicKey(i)).toBigInt();
            })
        );
        return new PointG2().fromBigInts(mpkBigInts as [bigint, bigint, bigint, bigint]);
    }
}
