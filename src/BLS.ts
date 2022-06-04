import { Fr, PointG1, PointG2, pairing, hashToCurveG1, ell } from "./EC/bn128";

/**
 * BLS signatures over the BN128 curve.
 */

export function KeyGen(): { sk: Fr; pk: PointG2 } {
    const sk = new Fr().random();
    const pk = PointG2.one().mul(sk);
    return { sk, pk };
}

export function Sign(sk: Fr, msg: Uint8Array): PointG1 {
    return hashToCurveG1(msg).mul(sk);
}

export function Verify(pk: PointG2, msg: Uint8Array, sig: PointG1): boolean {
    const e1 = pairing(hashToCurveG1(msg), pk);
    const e2 = pairing(sig, PointG2.one());
    return e1.isEqual(e2);
}

export const HashToPointG1 = hashToCurveG1;

export function AggregateThresholdSignatures(signatures: PointG1[], xPoints: Fr[]): PointG1 {
    if (signatures.length !== xPoints.length) throw new Error();
    let sum = PointG1.zero();
    for (let i = 0; i < signatures.length; i++) {
        sum = sum.add(signatures[i].mul(ell(i, Fr.zero(), xPoints)));
    }
    return sum;
}
