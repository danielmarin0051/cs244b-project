import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { initSecp256k1, Fr } from "../src/EC/secp256k1";
import * as EthSchnorr from "../src/EthSchnorr";
import { stringToBytes } from "../src/utils";
import { TestSchnorr } from "../typechain";

const Q = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HalfQ = (Q >> 1n) + 1n;

describe("SchnorrSECP256K1", function () {
    let deployer: SignerWithAddress;
    let TestSchnorr: TestSchnorr;
    this.beforeAll(async () => {
        await initSecp256k1();
        [deployer] = await ethers.getSigners();
    });
    this.beforeEach(async () => {
        TestSchnorr = await (await ethers.getContractFactory("TestSchnorr")).deploy();
    });
    it("Generates valid PKs", async () => {
        const { pk } = EthSchnorr.KeyGen();
        expect(pk.getX().toBigInt() < HalfQ, "x coordinate of public key must be less than half group order.").to.be
            .true;
    });
    it("accepts valid signature", async function () {
        const { sk, pk } = EthSchnorr.KeyGen();
        const msg = stringToBytes("hello");
        const signature = EthSchnorr.Sign(sk, msg);
        const { PKx, PKyp, msgHash } = EthSchnorr.VerifyHelper(pk, msg);
        expect(
            await TestSchnorr.verifySignature(
                PKx.toBytes(),
                PKyp,
                signature.sig.toBytes(),
                msgHash.toBytes(),
                signature.nonceTimesGeneratorAddress
            )
        ).to.be.true;
        expect(EthSchnorr.EthVerify(pk, msg, signature)).to.be.true;
    });
    it("rejects invalid signature", async function () {
        const { sk, pk } = EthSchnorr.KeyGen();
        const msg = stringToBytes("hello");
        const { sig, e, nonceTimesGeneratorAddress } = EthSchnorr.Sign(sk, msg);
        const { PKx, PKyp, msgHash } = EthSchnorr.VerifyHelper(pk, msg);
        const fakeSig = sig.add(new Fr(1));
        expect(
            await TestSchnorr.verifySignature(
                PKx.toBytes(),
                PKyp,
                sig.add(new Fr(1)).toBytes(),
                msgHash.toBytes(),
                nonceTimesGeneratorAddress
            ),
            "SchnorrContract.verifySignature failed to reject bad signature"
        ).to.be.false;
        expect(
            EthSchnorr.EthVerify(pk, msg, { sig: fakeSig, e, nonceTimesGeneratorAddress }),
            "EthSchnorr.EthVerify failed to reject bad signature"
        ).to.be.false;
    });
    it("consumes < 30k gas", async function () {
        const { sk, pk } = EthSchnorr.KeyGen();
        const msg = stringToBytes("hello");
        const signature = EthSchnorr.Sign(sk, msg);
        const { PKx, PKyp, msgHash } = EthSchnorr.VerifyHelper(pk, msg);
        const gas = await TestSchnorr.estimateGas.verifySignature(
            PKx.toBytes(),
            PKyp,
            signature.sig.toBytes(),
            msgHash.toBytes(),
            signature.nonceTimesGeneratorAddress
        );
        expect(gas.lt(30 * 1000), "burns too much gas").to.be.true;
    });
});
