import { ethers } from "ethers";
import { BroadcastChannel, BroadcastChannel__factory, DKG, DKG__factory } from "../typechain";
import { PrivateNode } from "./common";
import { initBN128, PointG2 } from "./EC/bn128";
import { ACCOUNTS, PRIVATE_KEYS, RPC_URL_CHAIN_B, RPC_URL_CHAIN_C } from "./test_utils";
import * as BLS from "./BLS";
import { range } from "lodash";
import { DKGNode, executeDKGEndToEnd } from "./DKGNode";
import { DDKGWithAggregation } from "./DDKGWithAggregation";

const BASE_PORT = 50051;
const RPC_URL_DST = RPC_URL_CHAIN_B;
const RPC_URL_BROADCAST = RPC_URL_CHAIN_C;
const POLLING_INTERVAL_DST = 1000;
const POLLING_INTERVAL_BROADCAST = 1000;

const N_REGISTERED = 10;
const N_WAITLIST = 1;

// DKG contract constants
const STAKE = ethers.utils.parseEther("1");
const KEY_GEN_INTERVAL = N_WAITLIST;
const SECURITY_PARAMETER = 100;
const AGGREGATOR_BLOCK_DELTA = 1;

// DDKGWithAggregation constants
const DKG_REQUEST_TIMEOUT = 1;
const DKG_SYNC_DELTA_IN_SECONDS = 1;
const AGGREGATION_REQUEST_TIMEOUT = 1;
const AGGREGATION_SYNC_DELTA_IN_SECONDS = 1;
const BROADCAST_SYNC_DELTA_IN_BLOCKS = 20;

describe("DDKGWithAggregation", function () {
    const signersDst: Record<string, ethers.Wallet> = {};
    const signersBroadcast: Record<string, ethers.Wallet> = {};
    let DKG: DKG;
    let Broadcast: BroadcastChannel;
    this.beforeAll(async () => {
        await initBN128();

        const providerDst = new ethers.providers.JsonRpcProvider(RPC_URL_DST);
        const providerBroadcast = new ethers.providers.JsonRpcProvider(RPC_URL_BROADCAST);

        providerDst.pollingInterval = POLLING_INTERVAL_DST;
        providerBroadcast.pollingInterval = POLLING_INTERVAL_BROADCAST;

        for (const [index, key] of PRIVATE_KEYS.entries()) {
            signersDst[ACCOUNTS[index]] = new ethers.Wallet(key, providerDst);
            signersBroadcast[ACCOUNTS[index]] = new ethers.Wallet(key, providerBroadcast);
        }
    });
    this.beforeEach(async () => {
        Broadcast = await new BroadcastChannel__factory(signersBroadcast[ACCOUNTS[0]]).deploy();
        DKG = await new DKG__factory(signersDst[ACCOUNTS[0]]).deploy(
            STAKE,
            KEY_GEN_INTERVAL,
            SECURITY_PARAMETER,
            AGGREGATOR_BLOCK_DELTA
        );
    });
    it("works", async function () {
        this.timeout(30 * 1000);

        const { registeredNodes, aggregationPKs, aggregationIndices, MPK } = await initRegisteredNodes(DKG);
        const { waitlistNodes } = await initWaitlistNodes();

        for (const node of registeredNodes) {
            await DKG._TEST_register(node.ethAccount, node.server, node.pk.toBigInts(), { value: STAKE });
        }

        await DKG._TEST_SetMasterPK(MPK.toBigInts());
        console.log("MPK submitted");

        const nodes = [...registeredNodes, ...waitlistNodes];
        const servers: Record<string, DDKGWithAggregation> = {};

        for (const node of nodes) {
            servers[node.ethAccount] = new DDKGWithAggregation({
                node,

                port: getPort(node.server),

                rpcURLDst: RPC_URL_DST,
                rpcURLBroadcast: RPC_URL_BROADCAST,

                pollingIntervalDst: POLLING_INTERVAL_DST,
                pollingIntervalBroadcast: POLLING_INTERVAL_BROADCAST,

                DKG_CONTRACT_ADDRESS: DKG.address,
                BROADCAST_CONTRACT_ADDRESS: Broadcast.address,

                DKG_REQUEST_TIMEOUT,
                DKG_SYNC_DELTA_IN_SECONDS,
                AGGREGATION_REQUEST_TIMEOUT,
                AGGREGATION_SYNC_DELTA_IN_SECONDS,
                BROADCAST_SYNC_DELTA_IN_BLOCKS,

                saveOracleState: async () => {},
                loadOracleState: async () => {
                    if (!node.aggregationSK) return null;
                    return {
                        aggregationSK: node.aggregationSK,
                        aggregationPKs,
                        aggregationIndices,
                    };
                },
            });
        }

        console.log("Initializing servers");
        for (const node of nodes) {
            servers[node.ethAccount].listenAndHandleDKGWithAggregation();
        }

        console.log("setting up promises");
        const promises = Object.values(servers).map((server) => {
            return new Promise<void>((resolve) => {
                server.on(DDKGWithAggregation.events.DKGCompleted, resolve);
            });
        });

        console.log("registering nodes");
        // register waitlist nodes and trigger DKG
        for (const node of waitlistNodes) {
            await DKG.connect(signersDst[node.ethAccount]).register(node.server, node.pk.toBigInts(), { value: STAKE });
        }

        console.log("Awaiting promises");
        // wait promises
        await Promise.all(promises);

        for (const node of nodes) {
            servers[node.ethAccount].stopListeningToAllEvents();
            servers[node.ethAccount].removeAllListeners();
        }
    });
});

async function initRegisteredNodes(DKG: DKG) {
    const n = N_REGISTERED;
    const t = (await DKG.getThreshold(n)).toNumber();
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
