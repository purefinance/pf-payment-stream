const { expect } = require("chai");
const { ethToUsd } = require("../utils/misc");

const oracleAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" // ETH/USD Chainlink oracle

describe("PaymentStream", function() {

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

  it("Should create first stream and expect stream id: 0", async function() {

    // to keep things simple fundingAddress will be == payer for testing purposes

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

    expect(event.args.id).to.equal(0);
  
  });

  it("Should get stream 0", async function () {

    let stream = await paymentStream.getStream(0);

    const [ fundingAddress, payee ] = await ethers.getSigners();

    expect(stream.fundingAddress).to.equal(fundingAddress.address);
    expect(stream.payee).to.equal(payee.address);
    
  });

  it("Should get streams count and be 1", async function () {

    let streamsCount = await paymentStream.getStreamsCount();

    expect(streamsCount).to.equal(1);
    
  });

  it("Payer should set new funding address to 'thirdGuy' and then back to 'fundingAddress'", async function () {

    const [ fundingAddress, , thirdGuy ] = await ethers.getSigners();

    await paymentStream.setFundingAddress(0,thirdGuy.address);

    let streamInfo = await paymentStream.getStream(0);

    expect(streamInfo.fundingAddress).to.equal(thirdGuy.address);

    await paymentStream.setFundingAddress(0,fundingAddress.address);

    
  });

  it("Random person should fail to set new funding address (not the owner)", async function () {

    const [ fundingAddress, payee, thirdGuy, randomPerson ] = await ethers.getSigners();

    let rpPaymentStream = await paymentStream.connect(randomPerson);

    expect(rpPaymentStream.setFundingAddress(0,randomPerson.address)).to.be.revertedWith("Not stream owner");
    
    
  });

  it("Should return the correct claimable amount", async function () {


    await network.provider.send("evm_increaseTime", [86400]); // +1 day
    await network.provider.send("evm_mine");

    let claimable = await paymentStream.claimable(0);
    let claimableToken = await paymentStream.claimableToken(0);
    let afterOneDay = usdAmount.div(365);

    expect(claimable.gte(afterOneDay)).to.equal(true);

    /* 
        Checks if on-chain token amount is in line with the off-chain usd value
    */
    
    let offchainUsdValue = await ethToUsd(claimableToken);

    let offchainUsdValueFloor = offchainUsdValue.mul(95).div(100);
    let offchainUsdValueCeiling = offchainUsdValue.mul(105).div(100);

    expect(claimable.gte(offchainUsdValueFloor)).to.equal(true); // -5%
    expect(claimable.lte(offchainUsdValueCeiling)).to.equal(true); // +5%

  });


  it("fundingAddress approves PaymentStream as spender", async function () {

    fakeToken.approve(paymentStream.address,ethers.utils.parseEther("10000"));

  });  

  it("Payee claims his first drip", async function () {

    const [ fundingAddress, payee ] = await ethers.getSigners();

    let payeePaymentStream = await paymentStream.connect(payee);

    let initialBalance = await fakeToken.balanceOf(payee.address);

    await payeePaymentStream.claim(0);

    let afterBalance = await fakeToken.balanceOf(payee.address);

    expect(afterBalance.gt(initialBalance)).to.equal(true);

  });  

  it("Random person shouldn't be able to pause the stream", async function () {

    const [ fundingAddress, payee, thirdGuy, randomPerson ] = await ethers.getSigners();

    let rpPaymentStream = await paymentStream.connect(randomPerson);

    expect(rpPaymentStream.pauseStream(0)).to.be.revertedWith("Not stream owner");
    
  });

  it("Payer delegates 'thirdGuy' to pause/unpause stream and checks for paused = true", async function () {

    const [ fundingAddress, payee, thirdGuy, randomPerson ] = await ethers.getSigners();

    await paymentStream.delegatePausable(0, thirdGuy.address);

    let tgPaymentStream = await paymentStream.connect(thirdGuy);

    await tgPaymentStream.pauseStream(0);

    let streamInfo = await tgPaymentStream.getStream(0);

    expect(streamInfo.paused).to.equal(true);

  });

  it("Unpause stream", async function () {

    const [ fundingAddress, payee, thirdGuy, randomPerson ] = await ethers.getSigners();

    let tgPaymentStream = await paymentStream.connect(thirdGuy);

    await tgPaymentStream.unpauseStream(0);

    let streamInfo = await tgPaymentStream.getStream(0);

    expect(streamInfo.paused).to.equal(false);

  });  


  it("Sets the new payee", async function () {

    const [ fundingAddress, payee, thirdGuy, randomPerson, newPayee ] = await ethers.getSigners();

    await paymentStream.setPayee(0,newPayee.address);

    let streamInfo = await paymentStream.getStream(0);

    expect(streamInfo.payee).to.equal(newPayee.address);

  });

  it("Sets new funding rate", async function () {

    const [ fundingAddress, payee, thirdGuy, randomPerson, newPayee ] = await ethers.getSigners();

    let blockInfo = await ethers.provider.getBlock("latest");
    let deadline = blockInfo.timestamp + (86400 * 7); // 7 days from now

    await paymentStream.setFundingRate(0,usdAmount,deadline);

    let streamInfo = await paymentStream.getStream(0);

    expect(streamInfo.endTime).to.equal(deadline);

  });

  it("Payee should be able to claim the full amount after the deadline is expired", async function () {


    await network.provider.send("evm_increaseTime", [86400 * 8]); // +8 day
    await network.provider.send("evm_mine");

    let streamInfo = await paymentStream.getStream(0);
    let claimable = await paymentStream.claimable(0);

    let expectedClaimable = streamInfo.usdAmount.sub(streamInfo.claimed);

    expect(expectedClaimable).to.equal(claimable);

  });

});
