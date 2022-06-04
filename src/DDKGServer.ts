import { Fr } from "./EC/bn128";
import { Node } from "./common";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ProtoGrpcType } from "./proto/out/DKGService";
import { DKGServiceHandlers, DKGServiceClient } from "./proto/out/dkg_service_package/DKGService";
import { SendShareRequest } from "./proto/out/dkg_service_package/SendShareRequest";
import { HMAC } from "./utils";
import { logger } from "./logger";

interface IDDKGServer {
    start(): Promise<void>;
    stop(): Promise<void>;
    sendShare(node: Node, share: Fr): Promise<void>;
    getReceivedShares(): Record<number, Fr>;
}

const packageDefinition = protoLoader.loadSync("./src/proto/DKGService.proto");
const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoGrpcType;

export type DDKGServerConfig = {
    sk: Fr;
    port: number;
    nodes: Node[];
    index: number;
    sessionId: number;
    REQUEST_TIMEOUT_IN_SECONDS: number;
};

class DDKGServerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DDKGServerError";
    }
}

export class DDKGServer implements IDDKGServer {
    protected sk: Fr;
    protected port: number;
    protected nodes: Node[];
    protected index: number;
    protected server: grpc.Server;
    protected sessionId: number;
    protected REQUEST_TIMEOUT_IN_SECONDS: number;
    protected receivedShares: Record<number, Fr> = {};

    constructor({ index, nodes, port, sessionId, REQUEST_TIMEOUT_IN_SECONDS, sk }: DDKGServerConfig) {
        this.sk = sk;
        this.port = port;
        this.nodes = nodes;
        this.index = index;
        this.sessionId = sessionId;
        this.REQUEST_TIMEOUT_IN_SECONDS = REQUEST_TIMEOUT_IN_SECONDS;
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

    sendShare(node: Node, share: Fr): Promise<void> {
        const hmacTag = this.getHMACForShare(node, share, this.index, this.sessionId);
        const request: SendShareRequest = {
            index: this.index,
            sessionId: this.sessionId,
            share: share.toLittleEndianHexString(),
            hmacTag,
        };
        const client = this.getClient(node.server);
        const deadline = new Date();
        deadline.setSeconds(deadline.getSeconds() + this.REQUEST_TIMEOUT_IN_SECONDS);
        return new Promise((resolve, reject) => {
            client.SendShare(request, { deadline }, (err) => {
                if (err) {
                    console.error(err);
                    reject(err);
                }
                resolve();
            });
        });
    }

    getReceivedShares(): Record<number, Fr> {
        return this.receivedShares;
    }

    private getServicer(): DKGServiceHandlers {
        const GRPCServicer: DKGServiceHandlers = {
            SendShare: (call, callback) => {
                try {
                    const { index, sessionId, share: shareHexStr, hmacTag } = call.request;
                    if (!Number.isInteger(index) && index >= 0 && index < this.nodes.length) {
                        throw new DDKGServerError("Could not parse request.index");
                    }
                    if (this.receivedShares[index] !== undefined) {
                        throw new DDKGServerError("Share already received");
                    }
                    if (sessionId !== this.sessionId) {
                        throw new DDKGServerError("sessionId !== this.sessionId");
                    }
                    const node = this.findNodeByIndex(index);
                    if (node === null) {
                        throw new DDKGServerError("Could not find node with index request.index");
                    }
                    const share = new Fr().fromLittleEndianHexString(shareHexStr);
                    const expectedHmacTag = this.getHMACForShare(node, share, index, sessionId);
                    if (hmacTag !== expectedHmacTag) {
                        throw new DDKGServerError("hmacTag !== expectedHmacTag");
                    }
                    this.receivedShares[index] = share;
                    callback(null, {});
                } catch (error: any) {
                    if (error instanceof DDKGServerError) {
                        callback({ code: grpc.status.INVALID_ARGUMENT, message: error.message });
                        logger.warn(`DDKGServer: Received invalid request: ${error}`);
                    } else {
                        callback({ code: grpc.status.INTERNAL, message: "Internal error" });
                        logger.error(`DDKGServer: Internal error: ${error}`);
                        throw error;
                    }
                }
            },
        };
        return GRPCServicer;
    }

    private getServer(): grpc.Server {
        const server = new grpc.Server();
        server.addService(proto.dkg_service_package.DKGService.service, this.getServicer());
        return server;
    }

    private getClient(serverAddress: string): DKGServiceClient {
        return new proto.dkg_service_package.DKGService(serverAddress, grpc.credentials.createInsecure());
    }

    private getHMACForShare(node: Node, share: Fr, index: number, sessionId: number): string {
        const sharedDHKey = node.pk.mul(this.sk).toBytes();
        const data = `index:${index}|sessionId:${sessionId}|share:${share.toString()}`;
        return HMAC(sharedDHKey, data);
    }

    private findNodeByIndex(index: number): Node | null {
        return this.nodes.find((node) => node.index === index) ?? null;
    }
}
