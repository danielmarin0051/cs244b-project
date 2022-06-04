import { Fr as BN128Fr } from "./EC/bn128";
import { Fr as SECP256K1Fr } from "./EC/secp256k1";

// Algorithm: repeated squaring
// See https://github.com/ethereum/py_ecc/blob/master/py_ecc/fields/optimized_field_elements.py#L169
export function modExp(base: bigint, exp: bigint, mod: bigint): bigint {
    if (exp === 0n) return 1n;
    if (exp === 1n) return base;
    else if (exp % 2n === 0n) {
        return modExp((base * base) % mod, exp / 2n, mod);
    } else {
        return (modExp((base * base) % mod, exp / 2n, mod) * base) % mod;
    }
}

type Fr = BN128Fr | SECP256K1Fr;

// Lagrange basis polynomial
export function ellGeneric<T extends Fr>(i: number, x: T, xPoints: Fr[], type: new (n: number) => T): T {
    const x_i = xPoints[i];
    let prod = new type(1);
    for (const [j, x_j] of xPoints.entries()) {
        if (i !== j) {
            prod = prod.mul(x.sub(x_j).mul(x_i.sub(x_j).inv())) as T;
        }
    }
    return prod;
}

export function lagrangeInterpolationGeneric<T extends Fr>(points: [T, T][], type: new (n: number) => T) {
    const xPoints = points.map((p) => p[0]);

    function f(x: T): T {
        let sum = new type(0);
        for (const [i, [_, y]] of points.entries()) {
            sum = sum.add(y.mul(ellGeneric<T>(i, x, xPoints, type))) as T;
        }
        return sum;
    }

    return f;
}
