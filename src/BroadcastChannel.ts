import { Fr, PointG2 } from "./EC/bn128";
import { ethers } from "ethers";
import { BroadcastChannel, BroadcastChannel__factory } from "../typechain";
import { Node } from "./common";
import { arrayify } from "ethers/lib/utils";

interface IBroadcastChannel {
    broadcastCommits(commits: PointG2[]): Promise<void>;
    broadcastComplaints(complaints: number[]): Promise<void>;
    broadcastDisputes(disputes: Record<number, Fr>): Promise<void>;
    fetchCommits(): Promise<Record<number, PointG2[]>>;
    fetchComplaints(): Promise<Record<number, number[]>>;
    fetchDisputes(): Promise<Record<number, Record<number, Fr>>>;
}

enum Topics {
    COMMITS,
    COMPLAINTS,
    DISPUTES,
}

export type DKGBroadcastChannelConfig = {
    sessionId: number;
    ethPrivateKey: string;
    rpcURL: string;
    contractAddress: string;
    nodes: Node[];
    SYNC_DELTA_IN_BLOCKS: number;
};

export class DKGBroadcastChannel implements IBroadcastChannel {
    contract: BroadcastChannel;
    sessionId: number;
    nodes: Node[];
    SYNC_DELTA_IN_BLOCKS: number;

    constructor({
        sessionId,
        nodes,
        ethPrivateKey,
        rpcURL,
        contractAddress,
        SYNC_DELTA_IN_BLOCKS,
    }: DKGBroadcastChannelConfig) {
        this.sessionId = sessionId;
        this.nodes = nodes;
        const provider = new ethers.providers.JsonRpcProvider(rpcURL);
        provider.pollingInterval = 1000;
        const wallet = new ethers.Wallet(ethPrivateKey, provider);
        this.contract = BroadcastChannel__factory.connect(contractAddress, wallet);
        this.SYNC_DELTA_IN_BLOCKS = SYNC_DELTA_IN_BLOCKS;
    }
    async broadcastCommits(commits: PointG2[]): Promise<void> {
        const message = this.commitsToBytes(commits);
        await this.contract.broadcast(this.sessionId, Topics.COMMITS, message);
    }
    async broadcastComplaints(complaints: number[]): Promise<void> {
        const message = this.complaintsToBytes(complaints);
        await this.contract.broadcast(this.sessionId, Topics.COMPLAINTS, message);
    }
    async broadcastDisputes(disputes: Record<number, Fr>): Promise<void> {
        const message = this.disputesToBytes(disputes);
        await this.contract.broadcast(this.sessionId, Topics.DISPUTES, message);
    }
    async fetchCommits(): Promise<Record<number, PointG2[]>> {
        const logsBySender = await this.getLogsForTopic(Topics.COMMITS);
        const receivedCommits: Record<number, PointG2[]> = {};
        for (const node of this.nodes) {
            const logs = logsBySender[node.ethAccount];
            if (logs.length !== 1) continue;
            const message = logs[0].args.message;
            const commits = this.commitsFromBytes(arrayify(message));
            if (commits === null) continue;
            receivedCommits[node.index] = commits;
        }
        return receivedCommits;
    }
    async fetchComplaints(): Promise<Record<number, number[]>> {
        const logsBySender = await this.getLogsForTopic(Topics.COMPLAINTS);
        const receivedComplaints: Record<number, number[]> = {};
        for (const node of this.nodes) {
            const logs = logsBySender[node.ethAccount];
            if (logs.length !== 1) continue;
            const message = logs[0].args.message;
            const complaints = this.complaintsFromBytes(arrayify(message));
            if (complaints === null) continue;
            receivedComplaints[node.index] = complaints;
        }
        return receivedComplaints;
    }
    async fetchDisputes(): Promise<Record<number, Record<number, Fr>>> {
        const logsBySender = await this.getLogsForTopic(Topics.DISPUTES);
        const receivedDisputes: Record<number, Record<number, Fr>> = {};
        for (const node of this.nodes) {
            const logs = logsBySender[node.ethAccount];
            if (logs.length !== 1) continue;
            const message = logs[0].args.message;
            const disputes = this.disputesFromBytes(arrayify(message));
            if (disputes === null) continue;
            receivedDisputes[node.index] = disputes;
        }
        return receivedDisputes;
    }

    private commitsToBytes(commits: PointG2[]): Uint8Array {
        const byteArrays = commits.map((point) => point.toBytes());
        return this.mergeByteArrays(byteArrays);
    }

    private complaintsToBytes(complaints: number[]): Uint8Array {
        const byteArrays = complaints.map((num) => this.uint32ToBytes(num));
        return this.mergeByteArrays(byteArrays);
    }

    private disputesToBytes(disputes: Record<number, Fr>): Uint8Array {
        const byteArrays: Uint8Array[] = [];
        for (const [i, scalar] of Object.entries(disputes)) {
            const index = Number(i);
            const indexBytes = this.uint32ToBytes(index);
            const scalarBytes = scalar.toBytes();
            byteArrays.push(indexBytes);
            byteArrays.push(scalarBytes);
        }
        return this.mergeByteArrays(byteArrays);
    }

    private commitsFromBytes(bytes: Uint8Array): PointG2[] | null {
        if (bytes.length % PointG2.serializedByteSize() !== 0) return null;
        const commits: PointG2[] = [];
        for (let i = 0; i < bytes.length; i += PointG2.serializedByteSize()) {
            const point = new PointG2().fromBytes(bytes.slice(i, i + PointG2.serializedByteSize()));
            if (!point.n.isValid()) return null;
            commits.push(point);
        }
        return commits;
    }

    private complaintsFromBytes(bytes: Uint8Array): number[] | null {
        if (bytes.length % 4 !== 0) return null;
        const complaints: number[] = [];
        for (let i = 0; i < bytes.length; i += 4) {
            const number = this.uint32FromBytes(bytes.slice(i, i + 4));
            if (number < 0) return null;
            complaints.push(number);
        }
        return complaints;
    }

    private disputesFromBytes(bytes: Uint8Array): Record<number, Fr> | null {
        if (bytes.length % (Fr.byteSize() + 4) !== 0) return null;
        const disputes: Record<number, Fr> = {};
        for (let i = 0; i < bytes.length; i += Fr.byteSize() + 4) {
            const index = this.uint32FromBytes(bytes.slice(i, i + 4));
            if (index < 0) return null;
            const scalar = new Fr().fromBytes(bytes.slice(i + 4, i + Fr.byteSize() + 4));
            disputes[index] = scalar;
        }
        return disputes;
    }

    private uint32FromBytes(bytes: Uint8Array): number {
        const buff = bytes.buffer;
        const view = new DataView(buff);
        const num = view.getUint32(0, false);
        return num;
    }

    private uint32ToBytes(num: number): Uint8Array {
        // TODO: check for overflow/underflow
        const buff = new ArrayBuffer(4);
        const view = new DataView(buff);
        // TODO: should it be uint16?
        view.setUint32(0, num, false);
        return new Uint8Array(buff);
    }

    private mergeByteArrays(byteArrays: Uint8Array[]): Uint8Array {
        return byteArrays.reduce((acc, curr) => new Uint8Array([...acc, ...curr]), new Uint8Array());
    }

    private async getLogsForTopic(topic: Topics) {
        const nodeAddresses = this.nodes.map((node) => node.ethAccount);
        const filter = this.contract.filters.Broadcast(nodeAddresses as any, this.sessionId, topic);
        const logs = await this.contract.queryFilter(filter, -this.SYNC_DELTA_IN_BLOCKS);
        const logsBySender: Record<string, typeof logs> = {};
        this.nodes.forEach((node) => (logsBySender[node.ethAccount] = []));
        logs.forEach((log) => logsBySender[log.args.sender].push(log));
        return logsBySender;
    }
}
