import * as mcl from "mcl-wasm";
import * as EC from "./elements";
import { lagrangeInterpolationGeneric, ellGeneric } from "../algorithms";
import { keccak256 } from "ethers/lib/utils";

/**
 * See libff's implementation of BN128: https://github.com/scipr-lab/libff/blob/develop/libff/algebra/curves/alt_bn128/alt_bn128_init.cpp
 * and py_ecc's too: https://github.com/ethereum/py_ecc/blob/master/py_ecc/optimized_bn128/optimized_curve.py
 */

// Field Modulus `p`: see https://github.com/scipr-lab/libff/blob/develop/libff/algebra/curves/alt_bn128/alt_bn128_fields.cpp
// Note p == 3 mod 4
export const FIELD_MODULUS = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

// CURVE_ORDER `r`: see https://github.com/scipr-lab/libff/blob/develop/libff/algebra/curves/alt_bn128/alt_bn128_fields.cpp
// This is also the order of the groups G1 and G2
export const CURVE_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// For computing sqrt() on Fp. Uses the fact that FIELD_MODULUS == 3 mod 4.
// See https://www.rieselprime.de/ziki/Modular_square_root,
// https://github.com/PhilippSchindler/EthDKG/blob/master/fc19/client/crypto.py#L132
const FIELD_MODULUS_PLUS_1_OVER_4 = (FIELD_MODULUS + 1n) / 4n;

export async function initBN128() {
    await mcl.init(mcl.BN_SNARK1);
}

export class Fp extends EC.Fp {
    get MODULUS(): bigint {
        return FIELD_MODULUS;
    }
    sqrt(): Fp {
        return this.pow(new Fp(FIELD_MODULUS_PLUS_1_OVER_4) as this);
    }
    static zero(): Fp {
        return new Fp(0);
    }
    static one(): Fp {
        return new Fp(1);
    }
}

export class Fr extends EC.Fr {
    get MODULUS(): bigint {
        return CURVE_ORDER;
    }
    static zero(): Fr {
        return new Fr(0);
    }
    static one(): Fr {
        return new Fr(1);
    }
}

export class Fp2 extends EC.Fp2 {
    static zero(): Fp2 {
        return new Fp2([0, 0]);
    }
    static one(): Fp2 {
        return new Fp2([1, 0]);
    }
}

export class PointG1 extends EC.PointG1 {
    static zero(): PointG1 {
        return new PointG1([Fp.one(), Fp.one(), Fp.zero()]);
    }
    static one(): PointG1 {
        return new PointG1([Fp.one(), new Fp(2), Fp.one()]);
    }
}

export class PointG2 extends EC.PointG2 {
    static zero(): PointG2 {
        return new PointG2([Fp2.one(), Fp2.one(), Fp2.zero()]);
    }
    static one(): PointG2 {
        const x = new Fp2([
            "10857046999023057135944570762232829481370756359578518086990519993285655852781",
            "11559732032986387107991004021392285783925812861821192530917403151452391805634",
        ]);
        const y = new Fp2([
            "8495653923123431417604973247489272438418190587263600148770280649306958101930",
            "4082367875863433681332203403145435568316851327593401208105741076214120093531",
        ]);
        const z = Fp2.one();
        return new PointG2([x, y, z]);
    }
}

export function pairing(P1: PointG1, P2: PointG2): mcl.GT {
    return EC.pairing(P1, P2);
}

// ------ Algorithms -----

/**
 * Ideally, hashToCurve would have to be implemented in constant time
 * according to the specifications in https://datatracker.ietf.org/doc/draft-irtf-cfrg-hash-to-curve/
 * In fact, Herumi's mcl library alredy implements it: https://datatracker.ietf.org/doc/draft-irtf-cfrg-hash-to-curve/
 *
 * However, for simplicity we use a "try-and-increment", since hashToCurve() will also have to be
 * implemented in Solidity.
 * @param msg
 * @returns H(msg) \in G1
 */
export function hashToCurveG1(msg: Uint8Array): PointG1 {
    return mapToCurve(hashToField(msg));
}

function hashToField(msg: Uint8Array): Fp {
    return new Fp(BigInt(keccak256(msg)) % FIELD_MODULUS);
}

/**
 * Maps a field element to a G1 point on the curve
 * Curve equation is y^2 == x^3 + 3
 *
 * See hashToPoing from Kyber: https://github.com/dedis/kyber/blob/4e19b71bd4b8f3749dc5f83e9b898fb9c903df85/pairing/bn256/point.go#L226
 * Also mapToG1 from ETHDKG: https://github.com/PhilippSchindler/EthDKG/blob/master/fc19/client/crypto.py#L111
 * Also mapToPoint from BLS-Solidity-Python: https://github.com/ChihChengLiang/bls_solidity_python/blob/master/contracts/BLS.sol#L106
 * @param x
 * @returns
 */
function mapToCurve(x: Fp): PointG1 {
    while (true) {
        const y_squared = x.mul(x).mul(x).add(new Fp(3));
        const y = y_squared.sqrt();
        if (y.mul(y).isEqual(y_squared)) {
            return new PointG1([x, y, Fp.one()]);
        }
        x = x.add(new Fp(1));
    }
}

export function lagrangeInterpolation(points: [Fr, Fr][]): (x: Fr) => Fr {
    return lagrangeInterpolationGeneric(points, Fr);
}

// Lagrange basis polynomial
export function ell(i: number, x: Fr, xPoints: Fr[]): Fr {
    return ellGeneric<Fr>(i, x, xPoints, Fr);
}
