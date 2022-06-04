import { expect } from "chai";
import { ethers } from "ethers";
import { range, isEqual, sampleSize } from "lodash";
import { BroadcastChannel, BroadcastChannel__factory } from "../typechain";
import { Fr, initBN128, PointG2, lagrangeInterpolation } from "./EC/bn128";
import { Node } from "./common";
import { DDKGNode, DDKGNodeConfig } from "./DDKGNode";
import { DDKGNodeAttackerWrongShare } from "./DDKGNodeAttackers";
import { ACCOUNTS, PRIVATE_KEYS, randomSessionId, RPC_URL_CHAIN_C } from "./test_utils";

const N = 5;
const T = 3;
const BASE_PORT = 50051;
const RPC_URL_BROADCAST = RPC_URL_CHAIN_C;
const DKG_REQUEST_TIMEOUT = 1;
const DKG_SYNC_DELTA_IN_SECONDS = 1;
const BROADCAST_SYNC_DELTA_IN_BLOCKS = 10;

function getNode(index: number): { node: Node; sk: Fr } {
    const sk = new Fr().random();
    const pk = PointG2.one().mul(sk);
    const node: Node = {
        pk,
        index,
        server: `0.0.0.0:${BASE_PORT + index}`,
        ethAccount: ACCOUNTS[index],
        aggregationPK: null,
        aggregationIndex: null,
    };
    return { node, sk };
}

describe("DDKGNode", function () {
    const nodes: Node[] = [];
    const keys: Record<number, Fr> = {};
    let BroadcastChannel: BroadcastChannel;
    function getConfigForNode(node: Node, nodes: Node[], sessionId: number): DDKGNodeConfig {
        return {
            n: N,
            t: T,
            nodes,
            sessionId,

            sk: keys[node.index],
            ethPrivateKey: PRIVATE_KEYS[node.index],
            selfNode: node,

            port: BASE_PORT + node.index,
            rpcURLBroadcast: RPC_URL_BROADCAST,
            BROADCAST_CONTRACT_ADDRESS: BroadcastChannel.address,

            DKG_REQUEST_TIMEOUT,
            DKG_SYNC_DELTA_IN_SECONDS,
            BROADCAST_SYNC_DELTA_IN_BLOCKS,
        };
    }
    this.beforeAll(async () => {
        await initBN128();
        // init nodes
        for (const index of range(N)) {
            const { node, sk } = getNode(index);
            nodes.push(node);
            keys[index] = sk;
        }
        const deployer = new ethers.Wallet(PRIVATE_KEYS[0], new ethers.providers.JsonRpcProvider(RPC_URL_BROADCAST));
        BroadcastChannel = await new BroadcastChannel__factory(deployer).deploy();
        await BroadcastChannel.deployed();
    });
    it("works for multiple", async function () {
        this.timeout(DKG_SYNC_DELTA_IN_SECONDS * 5 * 1000);

        const sessionId = randomSessionId();
        const ddkgNodes: DDKGNode[] = nodes.map((node) => new DDKGNode(getConfigForNode(node, nodes, sessionId)));
        await executeEndToEnd(ddkgNodes);

        const allNodeIndices = new Set(range(N));
        expect(ddkgNodes.every((ddkgNode) => isEqual(ddkgNode.dkg.QUAL, allNodeIndices))).to.be.true;
        expect(ddkgNodes.every((ddkgNode) => !ddkgNode.dkg.mpk.isEqual(PointG2.zero()))).to.be.true;
        expect(ddkgNodes.every((ddkgNode) => ddkgNode.dkg.mpk.isEqual(ddkgNodes[0].dkg.mpk))).to.be.true;
        expect(ddkgNodesHaveDistinctMskShares(ddkgNodes)).to.be.true;
        expect(mskCanBeRecovered(ddkgNodes, T)).to.be.true;
    });
    it("works with WrongShareAttacker", async function () {
        this.timeout(DKG_SYNC_DELTA_IN_SECONDS * 5 * 1000);

        const sessionId = randomSessionId();
        const honestDDKGNodes = range(1, N).map((i) => new DDKGNode(getConfigForNode(nodes[i], nodes, sessionId)));
        const ddkgNodes = [
            new DDKGNodeAttackerWrongShare(getConfigForNode(nodes[0], nodes, sessionId)),
            ...honestDDKGNodes,
        ];
        await executeEndToEnd(ddkgNodes);

        const allHonestNodeIndices = new Set(range(1, N));
        const allDishonestNodeIndices = new Set([0]);
        expect(honestDDKGNodes.every((ddkgNode) => isEqual(ddkgNode.dkg.QUAL, allHonestNodeIndices))).to.be.true;
        expect(honestDDKGNodes.every((ddkgNode) => isEqual(ddkgNode.dkg.disqualified, allDishonestNodeIndices))).to.be
            .true;
        expect(honestDDKGNodes.every((ddkgNode) => !ddkgNode.dkg.mpk.isEqual(PointG2.zero()))).to.be.true;
        expect(honestDDKGNodes.every((ddkgNode) => ddkgNode.dkg.mpk.isEqual(honestDDKGNodes[0].dkg.mpk))).to.be.true;
        expect(ddkgNodesHaveDistinctMskShares(honestDDKGNodes)).to.be.true;
        expect(mskCanBeRecovered(ddkgNodes.slice(0, T + 1), T)).to.be.false;
    });
});

async function executeEndToEnd(nodes: DDKGNode[]): Promise<void> {
    await Promise.all(
        nodes.map(async (node) => {
            await node.runDDKG();
        })
    );
}

function ddkgNodesHaveDistinctMskShares(nodes: DDKGNode[]): boolean {
    for (const node_i of nodes) {
        for (const node_j of nodes) {
            if (node_i.dkg.index === node_j.dkg.index) continue;
            if (node_i.dkg.mskShare.isEqual(node_j.dkg.mskShare)) return false;
        }
    }
    return true;
}

function mskCanBeRecovered(QUAL_Nodes: DDKGNode[], t: number): boolean {
    if (QUAL_Nodes.length < t + 1) throw new Error("QUAL_Nodes.length < t + 1");
    const nodes = sampleSize(QUAL_Nodes, t + 1);
    const points: [Fr, Fr][] = nodes.map((node) => [new Fr(node.dkg.index + 1), node.dkg.mskShare]);
    const msk = lagrangeInterpolation(points)(Fr.zero());
    const expectedMsk = QUAL_Nodes.reduce<Fr>((sum, node) => sum.add(node.dkg.coeffs[0]), Fr.zero());
    return msk.isEqual(expectedMsk);
}
