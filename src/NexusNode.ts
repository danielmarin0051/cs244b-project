import { OracleState, PrivateNode } from "./common";
import { DDKGWithAggregation, DDKGWithAggregationConfig } from "./DDKGWithAggregation";
import { OracleNode, OracleNodeConfig } from "./OracleNode";

export type NexusNodeConfig = {
    node: PrivateNode;
    oracleState: OracleState | null;

    port: number;

    rpcURLSrc: string;
    rpcURLDst: string;
    rpcURLBroadcast: string;

    pollingIntervalSrc: number;
    pollingIntervalDst: number;
    pollingIntervalBroadcast: number;

    DKG_REQUEST_TIMEOUT: number;
    DKG_SYNC_DELTA_IN_SECONDS: number;
    AGGREGATION_REQUEST_TIMEOUT: number;
    AGGREGATION_SYNC_DELTA_IN_SECONDS: number;
    BROADCAST_SYNC_DELTA_IN_BLOCKS: number;

    BROADCAST_CONTRACT_ADDRESS: string;
    NEXUS_SRC_CONTRACT_ADDRESS: string;
    ORACLE_DST_CONTRACT_ADDRESS: string;
};

function getDKGConfig(
    config: NexusNodeConfig,
    loadOracleState: () => Promise<OracleState | null>,
    saveOracleState: (state: OracleState) => Promise<void>
): DDKGWithAggregationConfig {
    const {
        node,
        port,
        rpcURLDst,
        rpcURLBroadcast,
        pollingIntervalDst,
        pollingIntervalBroadcast,
        DKG_SYNC_DELTA_IN_SECONDS,
        DKG_REQUEST_TIMEOUT,
        AGGREGATION_REQUEST_TIMEOUT,
        AGGREGATION_SYNC_DELTA_IN_SECONDS,
        BROADCAST_SYNC_DELTA_IN_BLOCKS,
        BROADCAST_CONTRACT_ADDRESS,
        ORACLE_DST_CONTRACT_ADDRESS,
    } = config;
    return {
        node,
        port,

        rpcURLDst,
        rpcURLBroadcast,

        pollingIntervalDst,
        pollingIntervalBroadcast,

        DKG_CONTRACT_ADDRESS: ORACLE_DST_CONTRACT_ADDRESS,
        BROADCAST_CONTRACT_ADDRESS,

        DKG_REQUEST_TIMEOUT,
        DKG_SYNC_DELTA_IN_SECONDS,
        AGGREGATION_REQUEST_TIMEOUT,
        AGGREGATION_SYNC_DELTA_IN_SECONDS,
        BROADCAST_SYNC_DELTA_IN_BLOCKS,

        loadOracleState,
        saveOracleState,
    };
}

function getOracleNodeConfig(
    config: NexusNodeConfig,
    loadOracleState: () => Promise<OracleState | null>
): OracleNodeConfig {
    const {
        node,
        port,
        rpcURLSrc,
        rpcURLDst,
        pollingIntervalSrc,
        pollingIntervalDst,
        AGGREGATION_REQUEST_TIMEOUT,
        AGGREGATION_SYNC_DELTA_IN_SECONDS,
        NEXUS_SRC_CONTRACT_ADDRESS,
        ORACLE_DST_CONTRACT_ADDRESS,
    } = config;
    return {
        node,
        port,

        rpcURLSrc,
        rpcURLDst,

        pollingIntervalSrc,
        pollingIntervalDst,

        AGGREGATION_REQUEST_TIMEOUT,
        AGGREGATION_SYNC_DELTA_IN_SECONDS,

        MESSENGER_SRC_CONTRACT_ADDRESS: NEXUS_SRC_CONTRACT_ADDRESS,
        ORACLE_DST_CONTRACT_ADDRESS,
        loadOracleState,
    };
}

export class NexusNode {
    dkg: DDKGWithAggregation;
    oracle: OracleNode;
    oracleState: OracleState | null = null;

    constructor(config: NexusNodeConfig) {
        this.dkg = new DDKGWithAggregation(
            getDKGConfig(
                config,
                () => this.loadOracleState(),
                (state) => this.saveOracleState(state)
            )
        );
        this.oracle = new OracleNode(getOracleNodeConfig(config, () => this.loadOracleState()));
        this.oracleState = config.oracleState;
    }

    async start(): Promise<void> {
        console.log("Starting NexusNode server", this.dkg.config.node.ethAccount);
        this.dkg.on(DDKGWithAggregation.events.DKGInitiated, async () => {
            console.log("listened to DKGInitiated event, stopping Oracle...");
            await this.oracle.stopListening();
        });
        this.dkg.on(DDKGWithAggregation.events.DKGCompleted, async () => {
            console.log("listened to DKGCompleted, initializing Oracle...");
            await this.oracle.init();
            this.oracle.listenAndHandleOracleRoots();
        });
        this.dkg.listenAndHandleDKGWithAggregation();
    }

    async stop(): Promise<void> {
        this.dkg.removeAllListeners();
        this.dkg.stopListeningToAllEvents();
        await this.oracle.stopListening();
    }

    private async saveOracleState(state: OracleState): Promise<void> {
        this.oracleState = state;
    }

    private async loadOracleState(): Promise<OracleState | null> {
        return this.oracleState;
    }
}
