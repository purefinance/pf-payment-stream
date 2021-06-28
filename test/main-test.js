'use strict'

const { expect } = require('chai')
const { ethToUsd } = require('../utils/misc')
const { ethers, network } = require('hardhat')

const SWAP_MANAGER_ADDRESS = '0xb3361918F2651409a6302DcEC2B1F0C6241fEC2e'
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const DEX_UNISWAP = 0

const usdAmount = ethers.utils.parseEther('100000')
const streamId = 1

describe('PaymentStream', function () {
  let paymentStream
  let fakeToken

  before(async function () {
    const FakeERC20 = await ethers.getContractFactory('FakeERC20')
    fakeToken = await FakeERC20.deploy(ethers.utils.parseEther('1000000'))

    const PaymentStream = await ethers.getContractFactory('PaymentStream')
    paymentStream = await PaymentStream.deploy(SWAP_MANAGER_ADDRESS)

    await Promise.all([fakeToken.deployed(), paymentStream.deployed()])

    await paymentStream.addToken(fakeToken.address, DEX_UNISWAP, [
      USDC_ADDRESS,
      WETH_ADDRESS
    ])
  })

  it('Should create first stream and expect stream id: 1', async function () {
    // to keep things simple fundingAddress will be == payer for testing purposes

    const [fundingAddress, payee] = await ethers.getSigners()

    const blockInfo = await ethers.provider.getBlock('latest')

    const createStreamTx = await paymentStream.createStream(
      payee.address,
      usdAmount, // usdAmount scaled up to 18 decimals
      fakeToken.address,
      fundingAddress.address,
      blockInfo.timestamp + 86400 * 365 // 1 year
    )

    const { events } = await createStreamTx.wait()

    const event = events.find(newEvent => newEvent.event === 'StreamCreated')

    expect(event.args.id).to.equal(streamId)
  })

  it('Should get stream 1', async function () {
    const stream = await paymentStream.getStream(streamId)

    const [fundingAddress, payee] = await ethers.getSigners()

    expect(stream.fundingAddress).to.equal(fundingAddress.address)
    expect(stream.payee).to.equal(payee.address)
  })

  it('Should get streams count and be 2', async function () {
    const streamsCount = await paymentStream.getStreamsCount()

    expect(streamsCount).to.equal(2)
  })

  it("Payer should set new funding address to 'thirdGuy' and then back to 'fundingAddress'", async function () {
    const [fundingAddress, , thirdGuy] = await ethers.getSigners()

    await paymentStream.updateFundingAddress(streamId, thirdGuy.address)

    const streamInfo = await paymentStream.getStream(streamId)

    expect(streamInfo.fundingAddress).to.equal(thirdGuy.address)

    await paymentStream.updateFundingAddress(streamId, fundingAddress.address)
  })

  it('Random person should fail to set new funding address (not the owner)', async function () {
    const [, , , randomPerson] = await ethers.getSigners()

    const rpPaymentStream = await paymentStream.connect(randomPerson)

    expect(
      rpPaymentStream.updateFundingAddress(streamId, randomPerson.address)
    ).to.be.revertedWith('Not stream owner')
  })

  it('Setting new funding rate before oracle updates should fail', async function () {
    const blockInfo = await ethers.provider.getBlock('latest')
    const deadline = blockInfo.timestamp + 86400 * 7 // 7 days from now

    const updateFundingRateTx = paymentStream.updateFundingRate(
      streamId,
      usdAmount,
      deadline
    )

    expect(updateFundingRateTx).to.be.revertedWith('Oracle update error')
  })

  it('Should return the correct claimable amount', async function () {
    await network.provider.send('evm_increaseTime', [86400]) // +1 day
    await network.provider.send('evm_mine')

    const swapManager = await ethers.getContractAt(
      'ISwapManager',
      SWAP_MANAGER_ADDRESS
    )

    await swapManager['updateOracles()']()

    const claimable = await paymentStream.claimable(streamId)
    const claimableToken = await paymentStream.claimableToken(streamId)
    const afterOneDay = usdAmount.div(365)

    expect(claimable.gte(afterOneDay)).to.equal(true)

    /* 
        Checks if on-chain token amount is in line with the off-chain usd value
    */

    const offchainUsdValue = await ethToUsd(claimableToken)

    const offchainUsdValueFloor = offchainUsdValue.mul(95).div(100)
    const offchainUsdValueCeiling = offchainUsdValue.mul(105).div(100)

    expect(claimable.gte(offchainUsdValueFloor)).to.equal(true) // -5%
    expect(claimable.lte(offchainUsdValueCeiling)).to.equal(true) // +5%
  })

  it('fundingAddress approves PaymentStream as spender', async function () {
    fakeToken.approve(paymentStream.address, ethers.utils.parseEther('10000'))
  })

  it('Payee claims his first drip', async function () {
    const [, payee] = await ethers.getSigners()

    const payeePaymentStream = await paymentStream.connect(payee)

    const initialBalance = await fakeToken.balanceOf(payee.address)

    await payeePaymentStream.claim(streamId)

    const afterBalance = await fakeToken.balanceOf(payee.address)

    expect(afterBalance.gt(initialBalance)).to.equal(true)
  })

  it("Random person shouldn't be able to pause the stream", async function () {
    const [, , , randomPerson] = await ethers.getSigners()

    const rpPaymentStream = await paymentStream.connect(randomPerson)

    expect(rpPaymentStream.pauseStream(streamId)).to.be.revertedWith(
      'Not stream owner'
    )
  })

  it("Payer delegates 'thirdGuy' to pause/unpause stream and checks for paused = true", async function () {
    const [, , thirdGuy] = await ethers.getSigners()

    await paymentStream.delegatePausable(streamId, thirdGuy.address)

    const tgPaymentStream = await paymentStream.connect(thirdGuy)

    await tgPaymentStream.pauseStream(streamId)

    const streamInfo = await tgPaymentStream.getStream(streamId)

    expect(streamInfo.paused).to.equal(true)
  })

  it('Unpause stream', async function () {
    const [, , thirdGuy] = await ethers.getSigners()

    const tgPaymentStream = await paymentStream.connect(thirdGuy)

    await tgPaymentStream.unpauseStream(streamId)

    const streamInfo = await tgPaymentStream.getStream(streamId)

    expect(streamInfo.paused).to.equal(false)
  })

  it('Revokes pausable role', async function () {
    const [, , thirdGuy] = await ethers.getSigners()

    await paymentStream.revokePausable(streamId, thirdGuy.address)

    const tgPaymentStream = await paymentStream.connect(thirdGuy)

    expect(tgPaymentStream.pauseStream(streamId)).to.be.revertedWith(
      'Not stream owner/delegated'
    )
  })

  it('Sets the new payee', async function () {
    const [, , , , newPayee] = await ethers.getSigners()

    await paymentStream.updatePayee(streamId, newPayee.address)

    const streamInfo = await paymentStream.getStream(streamId)

    expect(streamInfo.payee).to.equal(newPayee.address)
  })

  it('Sets new funding rate', async function () {
    const blockInfo = await ethers.provider.getBlock('latest')
    const deadline = blockInfo.timestamp + 86400 * 7 // 7 days from now

    const claimable = await paymentStream.claimable(streamId)

    const updateFundingRateTx = await paymentStream.updateFundingRate(
      streamId,
      usdAmount,
      deadline
    )

    const { events } = await updateFundingRateTx.wait()

    const event = events.find(newEvent => newEvent.event === 'Claimed')

    expect(event.args.usdAmount.gte(claimable)).to.equal(true)

    const streamInfo = await paymentStream.getStream(streamId)

    expect(streamInfo.startTime.add(streamInfo.secs)).to.equal(deadline)
  })

  it('Payee should be able to claim the full amount after the deadline is expired', async function () {
    await network.provider.send('evm_increaseTime', [86400 * 8]) // +8 day
    await network.provider.send('evm_mine')

    const streamInfo = await paymentStream.getStream(streamId)
    const claimable = await paymentStream.claimable(streamId)

    const expectedClaimable = streamInfo.usdAmount.sub(streamInfo.claimed)

    expect(expectedClaimable).to.equal(claimable)
  })
})
