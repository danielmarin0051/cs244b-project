import { Fr, initBN128, PointG2 } from "./EC/bn128";
import { DKGBroadcastChannel, DKGBroadcastChannelConfig } from "./BroadcastChannel";
import { BroadcastChannel, BroadcastChannel__factory } from "../typechain";
import { ethers } from "ethers";
import { Node } from "./common";
import { ACCOUNTS, PRIVATE_KEYS, randomSessionId, RPC_URL_CHAIN_C } from "./test_utils";
import { range } from "lodash";
import { expect } from "chai";

const N = 3;
const RPC_URL = RPC_URL_CHAIN_C;
const SYNC_DELTA_IN_BLOCKS = 10;

function getConfigForNode(
    index: number,
    contractAddress: string,
    sessionId: number,
    nodes: Node[]
): DKGBroadcastChannelConfig {
    return {
        ethPrivateKey: PRIVATE_KEYS[index],
        rpcURL: RPC_URL,
        contractAddress,
        sessionId,
        SYNC_DELTA_IN_BLOCKS,
        nodes,
    };
}

describe("DKGBroadcastChannel", function () {
    let BroadcastChannel: BroadcastChannel;
    let deployer: ethers.Wallet;
    let NODES: Node[];
    this.beforeAll(async () => {
        await initBN128();

        deployer = new ethers.Wallet(PRIVATE_KEYS[0], new ethers.providers.JsonRpcProvider(RPC_URL));
        BroadcastChannel = await new BroadcastChannel__factory(deployer).deploy();
        await BroadcastChannel.deployed();

        NODES = range(N).map((index) => ({
            pk: PointG2.zero(),
            index,
            server: "",
            ethAccount: ACCOUNTS[index],
            aggregationPK: null,
            aggregationIndex: null,
        }));
    });
    it("broadcastCommits()", async () => {
        const sessionId = randomSessionId();
        const channel = new DKGBroadcastChannel(getConfigForNode(0, BroadcastChannel.address, sessionId, NODES));
        const commits = [PointG2.one(), PointG2.one().mul(new Fr(2))];
        await channel.broadcastCommits(commits);
    });
    it("fetchCommits()", async () => {
        const sessionId = randomSessionId();
        const channels: Record<number, DKGBroadcastChannel> = {};
        const allCommits: Record<number, PointG2[]> = {};
        for (const node of NODES) {
            const config = getConfigForNode(node.index, BroadcastChannel.address, sessionId, NODES);
            const channel = new DKGBroadcastChannel(config);
            const commits = [
                PointG2.one().mul(new Fr(2 * node.index + 1)),
                PointG2.one().mul(new Fr(2 * node.index + 2)),
            ];
            await channel.broadcastCommits(commits);
            allCommits[node.index] = commits;
            channels[node.index] = channel;
        }
        for (const node of NODES) {
            const receivedCommits = await channels[node.index].fetchCommits();
            for (const [i, commits] of Object.entries(allCommits)) {
                const index = Number(i);
                expect(receivedCommits[index]).to.not.equal(undefined);
                expect(receivedCommits[index].length).to.equal(commits.length);
                for (const [k, point] of commits.entries()) {
                    expect(point.isEqual(receivedCommits[index][k]));
                }
            }
        }
    });
    it("broadcastComplaints()", async () => {
        const sessionId = randomSessionId();
        const channel = new DKGBroadcastChannel(getConfigForNode(0, BroadcastChannel.address, sessionId, NODES));
        const complaints = [11, 33];
        await channel.broadcastComplaints(complaints);
    });
    it("fetchComplaints()", async () => {
        const sessionId = randomSessionId();
        const channels: Record<number, DKGBroadcastChannel> = {};
        const allComplaints: Record<number, number[]> = {};
        for (const node of NODES) {
            const config = getConfigForNode(node.index, BroadcastChannel.address, sessionId, NODES);
            const channel = new DKGBroadcastChannel(config);
            const complaints = [11, 33];
            await channel.broadcastComplaints(complaints);
            allComplaints[node.index] = complaints;
            channels[node.index] = channel;
        }
        for (const node of NODES) {
            const receivedComplaints = await channels[node.index].fetchComplaints();
            for (const [i, complaints] of Object.entries(allComplaints)) {
                const index = Number(i);
                expect(receivedComplaints[index]).to.not.equal(undefined);
                expect(receivedComplaints[index].length).to.equal(complaints.length);
                for (const [k, number] of complaints.entries()) {
                    expect(number).to.equal(receivedComplaints[index][k]);
                }
            }
        }
    });
    it("broadcastDisputes()", async () => {
        const sessionId = randomSessionId();
        const channel = new DKGBroadcastChannel(getConfigForNode(0, BroadcastChannel.address, sessionId, NODES));
        const disputes = { 11: new Fr(2), 33: new Fr(3) };
        await channel.broadcastDisputes(disputes);
    });
    it("fetchDisputes()", async () => {
        const sessionId = randomSessionId();
        const channels: Record<number, DKGBroadcastChannel> = {};
        const allDisputes: Record<number, Record<number, Fr>> = {};
        for (const node of NODES) {
            const config = getConfigForNode(node.index, BroadcastChannel.address, sessionId, NODES);
            const channel = new DKGBroadcastChannel(config);

            const disputes: Record<number, Fr> = {};
            for (const node_j of NODES) {
                if (node_j.index === node.index) continue;
                disputes[node_j.index] = new Fr(node_j.index ** 2);
            }

            await channel.broadcastDisputes(disputes);
            allDisputes[node.index] = disputes;
            channels[node.index] = channel;
        }
        for (const node of NODES) {
            const receivedDisputes = await channels[node.index].fetchDisputes();
            for (const i of Object.keys(allDisputes).map(Number)) {
                expect(receivedDisputes[i]).to.not.equal(undefined);
                for (const j of Object.keys(allDisputes[i]).map(Number)) {
                    expect(receivedDisputes[i][j]).to.not.equal(undefined);
                    expect(receivedDisputes[i][j].isEqual(allDisputes[i][j])).to.be.true;
                }
            }
        }
    });
});
