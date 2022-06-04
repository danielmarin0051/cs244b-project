import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Messenger, Messenger__factory, Oracle, Oracle__factory } from "../typechain";

const STAKE = ethers.utils.parseEther("1");
const KEY_GEN_INTERVAL = 1;
const SECURITY_PARAMETER = 50;
const AGGREGATOR_BLOCK_DELTA = 2;
const ORACLE_AGGREGATION_EPOCH_LENGTH = 2;

describe("Oracle", function () {
    let signers: SignerWithAddress[];
    let Oracle: Oracle;
    this.beforeAll(async () => {
        signers = await ethers.getSigners();
    });
    this.beforeEach(async () => {
        Oracle = await new Oracle__factory(signers[0]).deploy(
            STAKE,
            KEY_GEN_INTERVAL,
            SECURITY_PARAMETER,
            AGGREGATOR_BLOCK_DELTA,
            ORACLE_AGGREGATION_EPOCH_LENGTH
        );
    });
    it("Has correct initial values", async function () {
        expect(await Oracle.ORACLE_AGGREGATION_EPOCH_LENGTH()).to.equal(ORACLE_AGGREGATION_EPOCH_LENGTH);
        expect(await Oracle.oracleRandomness()).to.equal(0);
    });
    it("getEpoch() works", async () => {
        const blocknumberZero = (await Oracle.ORACLE_BLOCK_NUMBER_ZERO()).toNumber();
        const blocknumber1 = blocknumberZero;
        const blocknumber2 = blocknumberZero + ORACLE_AGGREGATION_EPOCH_LENGTH;
        const blocknumber3 = blocknumberZero + 2 * ORACLE_AGGREGATION_EPOCH_LENGTH;
        const blocknumber4 = blocknumberZero + 1;
        const blocknumber5 = blocknumberZero - 1;
        expect(await Oracle.getEpoch(blocknumber1)).to.equal(0);
        expect(await Oracle.getEpoch(blocknumber2)).to.equal(1);
        expect(await Oracle.getEpoch(blocknumber3)).to.equal(2);
        expect(await Oracle.getEpoch(blocknumber4)).to.equal(0);
        await expect(Oracle.getEpoch(blocknumber5)).to.be.reverted;
    });
});
