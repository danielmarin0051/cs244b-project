import { ethers } from "ethers";
import { Fr, PointG2 } from "./EC/bn128";

export interface Node {
    pk: PointG2;
    index: number;
    server: string;
    ethAccount: string;
    aggregationPK: PointG2 | null;
    aggregationIndex: number | null;
}

export interface AggregationNode extends Node {
    aggregationPK: PointG2;
    aggregationIndex: number;
}

export interface PrivateNode extends Omit<Node, "index"> {
    sk: Fr;
    ethPrivateKey: string;
    aggregationSK: Fr | null;
}

export type OracleState = {
    aggregationSK: Fr;
    aggregationPKs: Record<string, PointG2>;
    aggregationIndices: Record<string, number>;
};

export type SolidityNode = [
    string,
    ethers.BigNumber,
    ethers.BigNumber,
    [ethers.BigNumber, ethers.BigNumber, ethers.BigNumber, ethers.BigNumber]
];

export function getNodeFromSolidityNode(
    node: SolidityNode,
    account: string,
    index: number,
    aggregationPK: PointG2 | null,
    aggregationIndex: number | null
): Node {
    const [server, , , pkBN] = node;

    const pk = new PointG2().fromBigInts([
        pkBN[0].toBigInt(),
        pkBN[1].toBigInt(),
        pkBN[2].toBigInt(),
        pkBN[3].toBigInt(),
    ]);

    return {
        pk,
        index,
        server,
        ethAccount: account,
        aggregationPK: aggregationPK ?? null,
        aggregationIndex: aggregationIndex ?? null,
    };
}

export function getAggregationNodeFromSolidityNode(
    node: SolidityNode,
    account: string,
    index: number,
    aggregationPK: PointG2,
    aggregationIndex: number
): AggregationNode {
    const [server, , , pkBN] = node;

    const pk = new PointG2().fromBigInts([
        pkBN[0].toBigInt(),
        pkBN[1].toBigInt(),
        pkBN[2].toBigInt(),
        pkBN[3].toBigInt(),
    ]);

    return {
        pk,
        index,
        server,
        ethAccount: account,
        aggregationPK,
        aggregationIndex,
    };
}
