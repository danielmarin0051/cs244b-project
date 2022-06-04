import { ethers } from "ethers";
import { range } from "lodash";
import {
    BroadcastChannel,
    BroadcastChannel__factory,
    Nexus,
    Nexus__factory,
    Oracle,
    Oracle__factory,
} from "../typechain";
import { PrivateNode } from "./common";
import { DKGNode, executeDKGEndToEnd } from "./DKGNode";
import { initBN128, PointG2 } from "./EC/bn128";
import { ACCOUNTS, PRIVATE_KEYS, RPC_URL_CHAIN_A, RPC_URL_CHAIN_B, RPC_URL_CHAIN_C } from "./test_utils";
import * as BLS from "./BLS";
import { NexusNode } from "./NexusNode";

const BASE_PORT = 50051;

const N_REGISTERED = 10;
const N_WAITLIST = 3;

// Nexus contract constant
const ORIGIN_CHAIN_ID = 1;

// Oracle contract constants
const STAKE = ethers.utils.parseEther("1");
const KEY_GEN_INTERVAL = N_WAITLIST;
const SECURITY_PARAMETER = 100;
const DKG_AGGREGATION_EPOCH_LENGTH = 1;
const ORACLE_AGGREGATION_EPOCH_LENGTH = 2;

//
const RPC_URL_SRC = RPC_URL_CHAIN_A;
const RPC_URL_DST = RPC_URL_CHAIN_B;
const RPC_URL_BROADCAST = RPC_URL_CHAIN_C;

const POLLING_INTERVAL_SRC = 1000;
const POLLING_INTERVAL_DST = 1000;
const POLLING_INTERVAL_BROADCAST = 1000;

const DKG_REQUEST_TIMEOUT = 1;
const DKG_SYNC_DELTA_IN_SECONDS = 1;
const AGGREGATION_REQUEST_TIMEOUT = 1;
const AGGREGATION_SYNC_DELTA_IN_SECONDS = 1;
const BROADCAST_SYNC_DELTA_IN_BLOCKS = 20;

describe("NexusNode", function () {
    const signersSrc: Record<string, ethers.Wallet> = {};
    const signersDst: Record<string, ethers.Wallet> = {};
    const signersBroadcast: Record<string, ethers.Wallet> = {};

    let providerSrc: ethers.providers.JsonRpcProvider;
    let providerDst: ethers.providers.JsonRpcProvider;
    let providerBroadcast: ethers.providers.JsonRpcProvider;

    let Broadcast: BroadcastChannel;
    let NexusSrc: Nexus;
    let OracleDst: Oracle;

    this.beforeAll(async () => {
        await initBN128();

        providerSrc = new ethers.providers.JsonRpcProvider(RPC_URL_SRC);
        providerDst = new ethers.providers.JsonRpcProvider(RPC_URL_DST);
        providerBroadcast = new ethers.providers.JsonRpcProvider(RPC_URL_BROADCAST);

        providerSrc.pollingInterval = POLLING_INTERVAL_SRC;
        providerDst.pollingInterval = POLLING_INTERVAL_DST;
        providerBroadcast.pollingInterval = POLLING_INTERVAL_BROADCAST;

        for (const index of range(N_REGISTERED + N_WAITLIST)) {
            signersSrc[ACCOUNTS[index]] = new ethers.Wallet(PRIVATE_KEYS[index], providerSrc);
            signersDst[ACCOUNTS[index]] = new ethers.Wallet(PRIVATE_KEYS[index], providerDst);
            signersBroadcast[ACCOUNTS[index]] = new ethers.Wallet(PRIVATE_KEYS[index], providerBroadcast);
        }
    });
    this.beforeEach(async () => {
        Broadcast = await new BroadcastChannel__factory(signersBroadcast[ACCOUNTS[0]]).deploy();
        NexusSrc = await new Nexus__factory(signersSrc[ACCOUNTS[0]]).deploy(ORIGIN_CHAIN_ID);
        OracleDst = await new Oracle__factory(signersDst[ACCOUNTS[0]]).deploy(
            STAKE,
            KEY_GEN_INTERVAL,
            SECURITY_PARAMETER,
            DKG_AGGREGATION_EPOCH_LENGTH,
            ORACLE_AGGREGATION_EPOCH_LENGTH
        );
    });
    it("works", async function () {
        this.timeout(20 * 1000);

        // init registered nodes
        const { registeredNodes, aggregationPKs, aggregationIndices } = await initRegisteredNodes(OracleDst);
        // init waitlist nodes
        const { waitlistNodes } = await initWaitlistNodes();

        // create NexusNode servers
        const nodes = [...registeredNodes, ...waitlistNodes];
        const servers: Record<string, NexusNode> = {};
        for (const node of nodes) {
            const isRegisteredNode = registeredNodes.findIndex((rnode) => rnode.ethAccount === node.ethAccount) !== -1;
            servers[node.ethAccount] = new NexusNode({
                node,
                oracleState: isRegisteredNode
                    ? { aggregationSK: node.aggregationSK!, aggregationPKs, aggregationIndices }
                    : null,
                port: getPort(node.server),

                rpcURLSrc: RPC_URL_SRC,
                rpcURLDst: RPC_URL_DST,
                rpcURLBroadcast: RPC_URL_BROADCAST,

                pollingIntervalSrc: POLLING_INTERVAL_SRC,
                pollingIntervalDst: POLLING_INTERVAL_DST,
                pollingIntervalBroadcast: POLLING_INTERVAL_BROADCAST,

                DKG_REQUEST_TIMEOUT,
                DKG_SYNC_DELTA_IN_SECONDS,
                AGGREGATION_REQUEST_TIMEOUT,
                AGGREGATION_SYNC_DELTA_IN_SECONDS,
                BROADCAST_SYNC_DELTA_IN_BLOCKS,

                BROADCAST_CONTRACT_ADDRESS: Broadcast.address,
                NEXUS_SRC_CONTRACT_ADDRESS: NexusSrc.address,
                ORACLE_DST_CONTRACT_ADDRESS: OracleDst.address,
            });
        }

        // Mine one block from src chain to avoid blocknumber == 0
        await providerSrc.send("hardhat_mine", []);

        // start listening for DKG
        for (const node of nodes) {
            await servers[node.ethAccount].start();
        }

        // setup DKGCompleted promise
        const DKGCompletedPromise = new Promise<void>((resolve) => {
            OracleDst.once(OracleDst.filters.DKGCompleted(), () => resolve());
        });
        // setup RootSubmitted promise
        const RootSubmittedPromise = new Promise<void>((resolve) => {
            OracleDst.once(OracleDst.filters.RootSubmitted(), () => resolve());
        });

        // trigger dkg by registering waitlist nodes
        for (const node of waitlistNodes) {
            await OracleDst.connect(signersDst[node.ethAccount]).register(node.server, node.pk.toBigInts(), {
                value: STAKE,
            });
        }

        // wait for DKGCompleted promise to resolve
        // this triggers the oracle
        await Promise.resolve(DKGCompletedPromise);

        // wait for RootSubmitted promise to resolve
        await Promise.resolve(RootSubmittedPromise);

        // stop all
        for (const node of nodes) {
            await servers[node.ethAccount].stop();
        }
    });
});

// TODO: Reconcile with DDKGWithAggregation.test.ts
async function initRegisteredNodes(OracleDst: Oracle) {
    const n = N_REGISTERED;
    const t = (await OracleDst.getThreshold(n)).toNumber();
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
        await OracleDst._TEST_register(node.ethAccount, node.server, node.pk.toBigInts(), {
            value: STAKE,
        });
    }

    await OracleDst._TEST_SetMasterPK(MPK.toBigInts());

    return { registeredNodes, aggregationPKs, aggregationIndices, MPK };
}

async function initWaitlistNodes() {
    const waitlistNodes: PrivateNode[] = range(N_REGISTERED, N_REGISTERED + N_WAITLIST).map((index) => {
        const { sk, pk } = BLS.KeyGen();
        return {
            sk,
            pk,
            server: getServer(index),
            ethAccount: ACCOUNTS[index],
            ethPrivateKey: PRIVATE_KEYS[index],
            aggregationSK: null,
            aggregationPK: null,
            aggregationIndex: null,
        };
    });
    return { waitlistNodes };
}

function getServer(index: number): string {
    return `0.0.0.0:${BASE_PORT + index}`;
}

function getPort(server: string): number {
    return Number(server.slice("0.0.0.0:".length));
}
