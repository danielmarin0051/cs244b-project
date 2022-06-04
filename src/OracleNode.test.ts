import { ethers } from "ethers";
import { range } from "lodash";
import { Messenger, Messenger__factory, Oracle, Oracle__factory } from "../typechain";
import { initBN128, PointG2 } from "./EC/bn128";
import { OracleNode } from "./OracleNode";
import { ACCOUNTS, PRIVATE_KEYS, RPC_URL_CHAIN_A, RPC_URL_CHAIN_B } from "./test_utils";
import * as BLS from "./BLS";
import { PrivateNode } from "./common";
import { DKGNode, executeDKGEndToEnd } from "./DKGNode";

const BASE_PORT = 50051;
const RPC_URL_SRC = RPC_URL_CHAIN_A;
const RPC_URL_DST = RPC_URL_CHAIN_B;

const N_REGISTERED = 10;
const N_WAITLIST = 1; // irrelevant for this test
const POLLING_INTERVAL_SRC = 1000; // ms
const POLLING_INTERVAL_DST = 1000; // ms
const AGGREGATION_REQUEST_TIMEOUT = 1;
const AGGREGATION_SYNC_DELTA_IN_SECONDS = 1;

// Oracle Contract Constants
const STAKE = ethers.utils.parseEther("1");
const KEY_GEN_INTERVAL = N_WAITLIST; // irrelevant for this test
const SECURITY_PARAMETER = 100; // irrelevant for this test
const AGGREGATOR_BLOCK_DELTA = 1; // irrelevant for this test
const ORACLE_AGGREGATION_EPOCH_LENGTH = 2; // set to 2 so that root submission doesn't trigger one zombie round in tests

// Messenger contract constants
const ORIGIN_CHAIN_ID = 1;

describe("OracleNode", function () {
    const signers_src: Record<string, ethers.Wallet> = {};
    const signers_dst: Record<string, ethers.Wallet> = {};
    let provider_src: ethers.providers.JsonRpcProvider;
    let provider_dst: ethers.providers.JsonRpcProvider;
    let MessengerContractSrc: Messenger;
    let OracleContractDst: Oracle;
    this.beforeAll(async () => {
        await initBN128();

        provider_src = new ethers.providers.JsonRpcProvider(RPC_URL_SRC);
        provider_dst = new ethers.providers.JsonRpcProvider(RPC_URL_DST);

        provider_src.pollingInterval = POLLING_INTERVAL_SRC;
        provider_dst.pollingInterval = POLLING_INTERVAL_DST;

        for (const index of range(N_REGISTERED)) {
            signers_src[ACCOUNTS[index]] = new ethers.Wallet(PRIVATE_KEYS[index], provider_src);
            signers_dst[ACCOUNTS[index]] = new ethers.Wallet(PRIVATE_KEYS[index], provider_dst);
        }
    });
    this.beforeEach(async () => {
        MessengerContractSrc = await new Messenger__factory(signers_src[ACCOUNTS[0]]).deploy(ORIGIN_CHAIN_ID);
        OracleContractDst = await new Oracle__factory(signers_dst[ACCOUNTS[0]]).deploy(
            STAKE,
            KEY_GEN_INTERVAL,
            SECURITY_PARAMETER,
            AGGREGATOR_BLOCK_DELTA,
            ORACLE_AGGREGATION_EPOCH_LENGTH
        );
    });
    it("works", async function () {
        this.timeout(12 * 1000);

        const { registeredNodes, aggregationPKs, aggregationIndices } = await initRegisteredNodes(OracleContractDst);

        const servers: Record<string, OracleNode> = {};

        for (const node of registeredNodes) {
            const oracleNode = new OracleNode({
                node,
                port: getPort(node.server),

                rpcURLSrc: RPC_URL_SRC,
                rpcURLDst: RPC_URL_DST,

                pollingIntervalSrc: POLLING_INTERVAL_SRC,
                pollingIntervalDst: POLLING_INTERVAL_DST,

                AGGREGATION_REQUEST_TIMEOUT,
                AGGREGATION_SYNC_DELTA_IN_SECONDS,

                MESSENGER_SRC_CONTRACT_ADDRESS: MessengerContractSrc.address,
                ORACLE_DST_CONTRACT_ADDRESS: OracleContractDst.address,

                loadOracleState: async () => ({
                    aggregationSK: node.aggregationSK!,
                    aggregationPKs,
                    aggregationIndices,
                }),
            });
            await oracleNode.init();
            servers[node.ethAccount] = oracleNode;
        }

        // Mine one block from src chain to avoid blocknumber == 0
        await provider_src.send("hardhat_mine", []);
        // setup promise for root submission
        const promise1 = new Promise<void>((resolve) => {
            OracleContractDst.once(OracleContractDst.filters.RootSubmitted(), () => resolve());
        });
        await advanceUntilBeforeNextEpoch(OracleContractDst, provider_dst);
        // start servers (will listen to current block on dst)
        // this triggers one aggregation
        for (const node of registeredNodes) {
            servers[node.ethAccount].listenAndHandleOracleRoots();
        }
        await Promise.resolve(promise1);

        // Repeat

        // Mine one block from src chain
        await provider_src.send("hardhat_mine", []);
        // setup promise for root submission
        const promise2 = new Promise<void>((resolve) => {
            OracleContractDst.once(OracleContractDst.filters.RootSubmitted(), () => resolve());
        });
        // // Trigger aggregation on dst chain
        await advanceUntilBeforeNextEpoch(OracleContractDst, provider_dst);
        await Promise.resolve(promise2);

        for (const node of registeredNodes) {
            await servers[node.ethAccount].stopListening();
        }
    });
});

async function advanceUntilBeforeNextEpoch(
    OracleContractDst: Oracle,
    provider_dst: ethers.providers.JsonRpcProvider
): Promise<void> {
    let blocknumber = await provider_dst.getBlockNumber();
    const currentEpoch = await OracleContractDst.getEpoch(blocknumber);
    blocknumber += 1;
    let nextEpoch = await OracleContractDst.getEpoch(blocknumber);
    while (nextEpoch.eq(currentEpoch)) {
        await provider_dst.send("hardhat_mine", []);
        blocknumber += 1;
        nextEpoch = await OracleContractDst.getEpoch(blocknumber);
    }
}

// TODO: Reconcile with DDKGWithAggregation.test.ts
async function initRegisteredNodes(OracleContractDst: Oracle) {
    const n = N_REGISTERED;
    const t = (await OracleContractDst.getThreshold(n)).toNumber();
    const nodes = range(n).map((index) => new DKGNode(n, t, index));
    executeDKGEndToEnd(nodes);

    const registeredNodes: PrivateNode[] = nodes.map((node) => {
        const { sk, pk } = BLS.KeyGen();
        return {
            sk,
            pk,
            server: getServer(node.index),
            ethAccount: ACCOUNTS[node.index],
            ethPrivateKey: PRIVATE_KEYS[node.index],
            aggregationSK: node.mskShare,
            aggregationPK: nodes[0].QUALPublicKeys[node.index],
            aggregationIndex: node.index,
        };
    });

    const MPK = nodes[0].mpk;
    const aggregationPKs: Record<string, PointG2> = {};
    const aggregationIndices: Record<string, number> = {};

    for (const node of registeredNodes) {
        aggregationPKs[node.ethAccount] = node.aggregationPK!;
        aggregationIndices[node.ethAccount] = node.aggregationIndex!;
    }

    for (const node of registeredNodes) {
        await OracleContractDst._TEST_register(node.ethAccount, node.server, node.pk.toBigInts(), {
            value: STAKE,
        });
    }

    await OracleContractDst._TEST_SetMasterPK(MPK.toBigInts());

    return { registeredNodes, aggregationPKs, aggregationIndices, MPK };
}

function getServer(index: number): string {
    return `0.0.0.0:${BASE_PORT + index}`;
}

function getPort(server: string): number {
    return Number(server.slice("0.0.0.0:".length));
}
