import { DKGNode } from "./DKGNode";
import { sleep } from "./utils";
import { DKGBroadcastChannel } from "./BroadcastChannel";
import { Node } from "./common";
import { DDKGServer } from "./DDKGServer";
import { Fr, PointG2 } from "./EC/bn128";
import { logger } from "./logger";

export type DDKGNodeConfig = {
    n: number;
    t: number;
    nodes: Node[];
    sessionId: number;

    sk: Fr;
    ethPrivateKey: string;
    selfNode: Node;

    port: number;
    rpcURLBroadcast: string;

    BROADCAST_CONTRACT_ADDRESS: string;

    DKG_REQUEST_TIMEOUT: number;
    DKG_SYNC_DELTA_IN_SECONDS: number;
    BROADCAST_SYNC_DELTA_IN_BLOCKS: number;
};

export class DDKGNode {
    dkg: DKGNode;

    private config: DDKGNodeConfig;
    private nodes: Node[];
    private server: DDKGServer;
    private broadcast: DKGBroadcastChannel;
    private SYNC_DELTA_IN_SECONDS: number;

    constructor(config: DDKGNodeConfig) {
        const {
            n,
            t,
            nodes,
            sessionId,

            sk,
            ethPrivateKey,
            selfNode,

            port,
            rpcURLBroadcast,

            BROADCAST_CONTRACT_ADDRESS,

            DKG_REQUEST_TIMEOUT,
            DKG_SYNC_DELTA_IN_SECONDS,
            BROADCAST_SYNC_DELTA_IN_BLOCKS,
        } = config;
        this.config = config;
        this.nodes = nodes;
        this.dkg = new DKGNode(n, t, selfNode.index);
        this.server = new DDKGServer({
            sessionId,
            index: selfNode.index,
            nodes,
            port,
            sk,
            REQUEST_TIMEOUT_IN_SECONDS: DKG_REQUEST_TIMEOUT,
        });
        this.broadcast = new DKGBroadcastChannel({
            sessionId,
            nodes,
            rpcURL: rpcURLBroadcast,
            contractAddress: BROADCAST_CONTRACT_ADDRESS,
            ethPrivateKey,
            SYNC_DELTA_IN_BLOCKS: BROADCAST_SYNC_DELTA_IN_BLOCKS,
        });
        this.SYNC_DELTA_IN_SECONDS = DKG_SYNC_DELTA_IN_SECONDS;
    }

    async runDDKG(): Promise<void> {
        {
            const { n, t, sessionId, port, selfNode } = this.config;
            // logger.info(
            //     `DDKGNode #${this.dkg.index}: Initiating DKG, n: ${n}, t: ${t}, sessionId: ${sessionId}, port: ${port}, index: ${selfNode.index}, server: ${selfNode.server}, ethAccount: ${selfNode.ethAccount}`
            // );
            logger.info(
                `DDKGNode #${this.dkg.index}: Initiating DKG, n: ${n}, t: ${t}, sessionId: ${sessionId}, port: ${port}, index: ${selfNode.index}, server: ${selfNode.server}`
            );
        }

        // Step 0: Wait for everyone
        logger.info(`DDKGNode #${this.dkg.index}: starting server`);
        await this.server.start();
        await sleep(this.SYNC_DELTA_IN_SECONDS * 1000);

        // Step 1: Sharing Phase
        logger.info(`DDKGNode #${this.dkg.index}: executing sharing phase`);
        await this.sharingPhase();
        await sleep(this.SYNC_DELTA_IN_SECONDS * 1000);
        await this.server.stop();
        logger.info(`DDKGNode #${this.dkg.index}: server stopped`);

        // Step 2: Verification Phase
        logger.info(`DDKGNode #${this.dkg.index}: executing verfication phase`);
        await this.verificationPhase();
        await sleep(this.SYNC_DELTA_IN_SECONDS * 1000);

        // Step 3: Dispute Phase
        logger.info(`DDKGNode #${this.dkg.index}: executing dispute phase`);
        await this.disputePhase();
        await sleep(this.SYNC_DELTA_IN_SECONDS * 1000);

        // Step 4: Key Derivation Phase
        logger.info(`DDKGNode #${this.dkg.index}: executing key derivation phase`);
        await this.keyDerivationPhase();
    }

    async sharingPhase(): Promise<void> {
        const { shares, commits } = this.dkg.sharingPhase();
        await this.broadcast.broadcastCommits(commits);
        await Promise.all(
            this.nodes.map(async (node) => {
                this.server.sendShare(node, shares[node.index]);
            })
        );
    }

    async verificationPhase(): Promise<void> {
        this.dkg.receivedShares = this.server.getReceivedShares();
        this.dkg.receivedCommits = await this.broadcast.fetchCommits();

        const complaints = this.dkg.verificationPhase();
        if (complaints.length !== 0) {
            await this.broadcast.broadcastComplaints(complaints);
        }
    }

    async disputePhase(): Promise<void> {
        this.dkg.receivedComplaints = await this.broadcast.fetchComplaints();

        const disputes = this.dkg.disputePhase();
        if (Object.keys(disputes).length !== 0) {
            await this.broadcast.broadcastDisputes(disputes);
        }
    }

    async keyDerivationPhase(): Promise<void> {
        this.dkg.receivedDisputes = await this.broadcast.fetchDisputes();
        this.dkg.keyDerivationPhase();
        logger.info(
            `DDKGNode #${this.dkg.index}: QUAL: ${Array.from(this.dkg.QUAL)}, disqualified: ${Array.from(
                this.dkg.disqualified
            )}, mpk: ${this.dkg.mpk.toBigInts()}`
        );
    }

    getAggregationData() {
        const aggregationSK = this.dkg.mskShare;
        const aggregationPKs: Record<string, PointG2> = {};
        const aggregationIndices: Record<string, number> = {};
        for (const index of this.dkg.QUAL) {
            const nodeAccount = this.nodes[index].ethAccount;
            aggregationPKs[nodeAccount] = this.dkg.QUALPublicKeys[index];
            aggregationIndices[nodeAccount] = index;
        }
        return { aggregationSK, aggregationPKs, aggregationIndices };
    }
}
