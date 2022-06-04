import { AggregationNode } from "./common";
import { HMAC, sleep } from "./utils";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ProtoGrpcType } from "./proto/out/Aggregator";
import {
    AggregatorClient as AggregatorGRPCClient,
    AggregatorHandlers,
} from "./proto/out/aggregator_package/Aggregator";
import { Fr, PointG1 } from "./EC/bn128";
import { SignatureResponse__Output } from "./proto/out/aggregator_package/SignatureResponse";
import * as BLS from "./BLS";
import { arrayify } from "ethers/lib/utils";
import { logger } from "./logger";

const packageDefinition = protoLoader.loadSync("./src/proto/Aggregator.proto");
const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoGrpcType;

export enum AggregationTopic {
    DKG = "DKG",
    ROOT = "ROOT",
}

export type SignatureResolver = (
    aggregationId: number,
    topic: AggregationTopic
) => Promise<{ message: string; signature: PointG1; error: string | null }>;

export type AggregatorServerConfig = {
    port: number;
    aggregator: AggregationNode;
    aggregationSK: Fr;
    resolveSignatureRequest: SignatureResolver;
};

class AggregatorServerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AggregatorServerError";
    }
}

export class AggregatorServer {
    protected port: number;
    protected server: grpc.Server;
    protected aggregator: AggregationNode;
    protected aggregationSK: Fr;
    protected resolveSignatureRequest: SignatureResolver;

    constructor(config: AggregatorServerConfig) {
        this.port = config.port;
        this.aggregator = config.aggregator;
        this.aggregationSK = config.aggregationSK;
        this.resolveSignatureRequest = config.resolveSignatureRequest;
        this.server = this.getServer();
    }

    async start(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.server.bindAsync(`0.0.0.0:${this.port}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
                if (err) reject(err);
                resolve();
            });
        });
        this.server.start();
    }

    async stop(): Promise<void> {
        this.server.forceShutdown();
    }

    // --- Private ---

    protected getServer(): grpc.Server {
        const server = new grpc.Server();
        server.addService(proto.aggregator_package.Aggregator.service, this.getServicer());
        return server;
    }

    protected getServicer() {
        const GRPCServicer: AggregatorHandlers = {
            RequestSignature: async (call, callback) => {
                try {
                    const { aggregationId, hmacTag, topic } = call.request;
                    if (hmacTag !== this.getExpectedHMACTag(aggregationId)) {
                        throw new AggregatorServerError("hmacTag !== this.expectedHMACTag");
                    }
                    if (!Object.values<string>(AggregationTopic).includes(topic)) {
                        throw new AggregatorServerError("Invalid topic");
                    }
                    const { message, signature, error } = await this.resolveSignatureRequest(
                        aggregationId,
                        topic as AggregationTopic
                    );
                    if (error !== null) {
                        throw new AggregatorServerError(`Could not resolve signature, error: ${error}`);
                    }
                    callback(null, {
                        message: message,
                        signature: signature.toSerializedHexString(),
                    });
                } catch (error: any) {
                    if (error instanceof AggregatorServerError) {
                        callback({ code: grpc.status.INVALID_ARGUMENT, message: error.message });
                        logger.warn(`AggregatorServer: Received invalid request: ${error}`);
                    } else {
                        callback({ code: grpc.status.INTERNAL, message: "Internal error" });
                        logger.error(`AggregatorServer: Internal error: ${error}`);
                        throw error;
                    }
                }
            },
        };
        return GRPCServicer;
    }

    protected getExpectedHMACTag(aggregationId: number): string {
        const sharedDHKey = this.aggregator.aggregationPK.mul(this.aggregationSK).toBytes();
        const data = `aggregationId:${aggregationId}`;
        return HMAC(sharedDHKey, data);
    }
}

export type AggregatorClientConfig = {
    topic: AggregationTopic;
    message: string;
    aggregationSK: Fr;
    aggregationId: number;
    REQUEST_TIMEOUT: number;
};

export class AggregatorClient {
    protected config: AggregatorClientConfig;

    constructor(config: AggregatorClientConfig) {
        this.config = config;
    }

    async requestAndVerifySignature(node: AggregationNode): Promise<PointG1 | null> {
        try {
            const response = await this.requestSignatureGRPC(node);
            if (response === undefined) throw new Error("response === undefined");
            if (response.message !== this.config.message) throw new Error("response.message !== this.message");
            const signature = new PointG1().fromSerializedHexString(response.signature);
            if (!BLS.Verify(node.aggregationPK, arrayify(response.message), signature)) {
                throw new Error("!BLS.Verify");
            }
            return signature;
        } catch (err: any) {
            logger.warn(
                `AggregatorClient: response verification for node ${node.index}, aggregationId: ${this.config.aggregationId}, topic: ${this.config.topic} failed. Error: ${err.message}`
            );
            return null;
        }
    }

    protected async requestSignatureGRPC(node: AggregationNode): Promise<SignatureResponse__Output | undefined> {
        const deadline = new Date();
        deadline.setSeconds(deadline.getSeconds() + this.config.REQUEST_TIMEOUT);
        const client = this.getClient(node.server);
        const hmacTag = this.getHMACTagForNode(node);
        return new Promise((resolve, reject) => {
            client.RequestSignature(
                { aggregationId: this.config.aggregationId, hmacTag, topic: this.config.topic },
                { deadline },
                (err, response) => {
                    if (err) {
                        logger.warn(
                            `AggregatorClient: GRPC request to node ${node.index}, aggregationId: ${this.config.aggregationId}, topic: ${this.config.topic} failed. Error response: ${err}`
                        );
                        reject(err);
                    }
                    resolve(response);
                }
            );
        });
    }

    protected getClient(serverAddress: string): AggregatorGRPCClient {
        return new proto.aggregator_package.Aggregator(serverAddress, grpc.credentials.createInsecure());
    }

    protected getHMACTagForNode(node: AggregationNode): string {
        const sharedDHKey = node.aggregationPK.mul(this.config.aggregationSK).toBytes();
        const data = `aggregationId:${this.config.aggregationId}`;
        return HMAC(sharedDHKey, data);
    }
}

export type AggregatorConfig = {
    port: number;
    nodes: AggregationNode[];
    aggregationSK: Fr;
    AGGREGATION_SYNC_DELTA_IN_SECONDS: number;
    AGGREGATION_REQUEST_TIMEOUT: number;
    signatureResolver: SignatureResolver;
};

export class Aggregator {
    nodes: AggregationNode[];
    isServerRunning: boolean = false;

    protected ClientClass = AggregatorClient;
    protected ServerClass = AggregatorServer;
    protected config: AggregatorConfig;
    protected server: AggregatorServer | undefined = undefined;

    constructor(config: AggregatorConfig) {
        this.config = config;
        this.nodes = config.nodes;
    }

    async runAggregation(
        aggregationId: number,
        message: string,
        topic: AggregationTopic
    ): Promise<Record<number, PointG1 | null>> {
        logger.info(
            `Aggregator: Called runAggregation(aggregationId: ${aggregationId}, message: ${message}, topic: ${topic})`
        );
        const { nodes, aggregationSK, AGGREGATION_REQUEST_TIMEOUT, AGGREGATION_SYNC_DELTA_IN_SECONDS } = this.config;
        const client = new this.ClientClass({
            aggregationSK,
            topic,
            message,
            aggregationId,
            REQUEST_TIMEOUT: AGGREGATION_REQUEST_TIMEOUT,
        });
        logger.info(`Aggregator: runAggregation() sleeping for ${AGGREGATION_SYNC_DELTA_IN_SECONDS} seconds`);
        await sleep(AGGREGATION_SYNC_DELTA_IN_SECONDS * 1000);
        const signatures: Record<number, PointG1 | null> = {};
        logger.info(`Aggregator: runAggregation() requesting signatures to nodes: ${nodes.map((node) => node.index)}`);
        await Promise.all(
            nodes.map(async (node) => {
                signatures[node.index] = await client.requestAndVerifySignature(node);
            })
        );
        logger.info(
            `Aggregator: runAggregation() received valid signatures from nodes: ${Object.keys(signatures)
                .map(Number)
                .filter((index) => signatures[index] !== null)}`
        );
        return signatures;
    }

    async startAggregationServer(aggregatorNode: AggregationNode): Promise<void> {
        logger.info(`Aggregator: starting aggregation server, aggregatorNode: ${aggregatorNode.index}`);
        const { aggregationSK, port, signatureResolver } = this.config;

        this.server = new this.ServerClass({
            aggregationSK,
            port,
            aggregator: aggregatorNode,
            resolveSignatureRequest: signatureResolver,
        });
        await this.server.start();
        this.isServerRunning = true;
    }

    async stopAggregationServer(): Promise<void> {
        logger.info(`Aggregator: stopping aggregation server`);
        await this.server?.stop();
        this.isServerRunning = false;
    }
}
