import { keccak256 } from "ethers/lib/utils";
import { CURVE_ORDER, Fr, PointG1 } from "./EC/secp256k1";

/**
 * Schnorr signatures over the secp256k1 curve.
 */

export type SchnorrSignature = { s: Fr; e: Fr };

export function KeyGen(sk_?: Fr): { sk: Fr; pk: PointG1 } {
    const sk = sk_ ?? new Fr().random();
    const pk = PointG1.one().mul(sk);
    return { sk, pk };
}

export function Sign(sk: Fr, msg: Uint8Array): SchnorrSignature {
    const k = new Fr().random();
    const r = PointG1.one().mul(k);
    const e = Hash(r.toBytes(), msg);
    const s = k.sub(sk.mul(e));
    return { s, e };
}

export function Verify(pk: PointG1, msg: Uint8Array, { s, e }: SchnorrSignature): boolean {
    const r_v = PointG1.one().mul(s).add(pk.mul(e));
    const e_v = Hash(r_v.toBytes(), msg);
    return e_v.isEqual(e);
}

// ---- Utilities -----

export function Hash(a: Uint8Array, b: Uint8Array): Fr {
    const hash = keccak256(new Uint8Array([...a, ...b]));
    return new Fr(BigInt(hash) % CURVE_ORDER);
}

export function signatureEqual(sigA: SchnorrSignature, sigB: SchnorrSignature): boolean {
    return sigA.e.isEqual(sigB.e) && sigA.s.isEqual(sigB.s);
}
