const { expect } = require("chai");

const oracleAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" // ETH/USD Chainlink oracle
const VSP = "0x1b40183efb4dd766f11bda7a7c3ad8982e998421";

describe("Security checks", function() {
    
    let paymentStream;
    let usdAmount = ethers.utils.parseEther("100000");
    let fakeToken;

    before(async function() {

        const FakeERC20 = await ethers.getContractFactory("FakeERC20");
        fakeToken = await FakeERC20.deploy(ethers.utils.parseEther("1000000"));
        
        const PaymentStream = await ethers.getContractFactory("PaymentStream");
        paymentStream = await PaymentStream.deploy();
    
        await Promise.all[ fakeToken.deployed(), paymentStream.deployed() ];
    
        await paymentStream.addToken(fakeToken.address, oracleAddress);
        
    });


    describe("addToken", function() {

        it("Invalid oracle address should revert", async function () {
         
            let addTokenTx = paymentStream.addToken(VSP,ethers.constants.AddressZero);

            expect(addTokenTx).to.be.revertedWith("Oracle address missing");
        
        });

    });

    describe("createStream", function() {

        it("endTime < current time should revert", async function () {

            const [ fundingAddress, payee ] = await ethers.getSigners();

            let blockInfo = await ethers.provider.getBlock("latest");
        
            let createStreamTx = paymentStream.createStream(
                payee.address, 
                usdAmount,
                fakeToken.address, 
                fundingAddress.address, 
                blockInfo.timestamp - 1
            );

            expect(createStreamTx).to.be.revertedWith("End time is in the past");

        });
    
        it("usdAmount = 0 should revert", async function () {

            const [ fundingAddress, payee ] = await ethers.getSigners();

            let blockInfo = await ethers.provider.getBlock("latest");
        
            let createStreamTx = paymentStream.createStream(
                payee.address, 
                0,
                fakeToken.address, 
                fundingAddress.address, 
                blockInfo.timestamp + (86400 * 365)
            );

            expect(createStreamTx).to.be.revertedWith("usdAmount == 0");

        });

        it("payee = fundingAddress should revert", async function () {

            const [ fundingAddress, payee ] = await ethers.getSigners();

            let blockInfo = await ethers.provider.getBlock("latest");
        
            let createStreamTx = paymentStream.createStream(
                payee.address, 
                usdAmount,
                fakeToken.address, 
                payee.address, 
                blockInfo.timestamp + (86400 * 365)
            );

            expect(createStreamTx).to.be.revertedWith("payee == fundingAddress");

        });

        it("payee and fundingAddress cannot be null", async function () {

            const [ fundingAddress, payee ] = await ethers.getSigners();

            let blockInfo = await ethers.provider.getBlock("latest");
        
            let createStreamTx = paymentStream.createStream(
                ethers.constants.AddressZero,
                usdAmount,
                fakeToken.address, 
                fundingAddress.address, 
                blockInfo.timestamp + (86400 * 365)
            );

            expect(createStreamTx).to.be.revertedWith("invalid payee or fundingAddress");

        });

        it("createStream with unsupported token should revert", async function () {

            const [ fundingAddress, payee ] = await ethers.getSigners();

            let blockInfo = await ethers.provider.getBlock("latest");
        
            let createStreamTx = paymentStream.createStream(
                payee.address,
                usdAmount,
                VSP, 
                fundingAddress.address, 
                blockInfo.timestamp + (86400 * 365)
            );

            expect(createStreamTx).to.be.revertedWith("Token not supported");

        });

    });


    describe("claim", function() {

        let streamId;

        before(async function() {

            const [ fundingAddress, payee ] = await ethers.getSigners();

            let blockInfo = await ethers.provider.getBlock("latest");

            let createStreamTx = await paymentStream.createStream(
                            payee.address, 
                            usdAmount, // usdAmount scaled up to 18 decimals
                            fakeToken.address, 
                            fundingAddress.address, 
                            blockInfo.timestamp + (86400 * 365) // 1 year
            );

            let { events } = await createStreamTx.wait();

            const event = events.find(event => event.event === 'newStream');

            streamId = event.args.id;

        });

        it("Claiming on paused stream should revert", async function () {

            const [ fundingAddress, payee ] = await ethers.getSigners();

            await paymentStream.pauseStream(streamId);

            let payeePaymentStream = await paymentStream.connect(payee);

            let claimTx = payeePaymentStream.claim(streamId);

            expect(claimTx).to.be.revertedWith("Stream is paused");

        });

        it("Claiming from non-payee should revert", async function () {

            const [ fundingAddress, payee, nonPayee ] = await ethers.getSigners();

            let nonPayeePaymentStream = await paymentStream.connect(nonPayee);

            let claimTx = nonPayeePaymentStream.claim(streamId);

            expect(claimTx).to.be.revertedWith("Not payee");

        });

    });

    describe("Editing a stream", function() {

        let streamId;

        before(async function() {

            const [ fundingAddress, payee ] = await ethers.getSigners();

            let blockInfo = await ethers.provider.getBlock("latest");

            let createStreamTx = await paymentStream.createStream(
                            payee.address, 
                            usdAmount, // usdAmount scaled up to 18 decimals
                            fakeToken.address, 
                            fundingAddress.address, 
                            blockInfo.timestamp + (86400 * 365) // 1 year
            );

            let { events } = await createStreamTx.wait();

            const event = events.find(event => event.event === 'newStream');

            streamId = event.args.id;


        });

        describe("delegatePausable", function() {

            it("Delegating to invalid address should revert", async function () {

                expect(paymentStream.delegatePausable(streamId,ethers.constants.AddressZero)).to.be.revertedWith("Invalid delegate");

            });

        });

        describe("setFundingAddress", function() {

            it("Setting an invalid funding address should revert", async function () {

                expect(paymentStream.setFundingAddress(streamId,ethers.constants.AddressZero)).to.be.revertedWith("newFundingAddress invalid");

            });

        });

        describe("setPayee", function() {

            it("Setting an invalid payee address should revert", async function () {

                expect(paymentStream.setPayee(streamId,ethers.constants.AddressZero)).to.be.revertedWith("newPayee invalid");

            });

        });

        describe("setFundingRate", function() {

            it("usdAmount = 0 should revert", async function () {

                let blockInfo = await ethers.provider.getBlock("latest");

                expect(paymentStream.setFundingRate(streamId,0,blockInfo.timestamp + 86400)).to.be.revertedWith("usdAmount = 0");

            });

            it("endTime < current time should revert", async function () {

                let blockInfo = await ethers.provider.getBlock("latest");

                expect(paymentStream.setFundingRate(streamId,usdAmount,blockInfo.timestamp - 86400)).to.be.revertedWith("End time is in the past");

            });

        });
    });


  });