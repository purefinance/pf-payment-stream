'use strict'

const { expect } = require('chai')
const { ethToUsd } = require('../utils/misc')
const { ethers, network } = require('hardhat')

const SWAP_MANAGER_ADDRESS = '0xe382d9f2394A359B01006faa8A1864b8a60d2710'
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const DEX_UNISWAP = 0

const usdAmount = ethers.utils.parseEther('100000')

describe('PaymentStream', function () {
  let paymentStreamFactory
  let fakeToken

  async function getStream(id) {
    const streamAddress = await paymentStreamFactory.getStream(id)

    return ethers.getContractAt('PaymentStream', streamAddress)
  }

  before(async function () {
    const FakeERC20 = await ethers.getContractFactory('FakeERC20')
    fakeToken = await FakeERC20.deploy(ethers.utils.parseEther('1000000'))

    const PaymentStreamFactory = await ethers.getContractFactory(
      'PaymentStreamFactory'
    )
    paymentStreamFactory = await PaymentStreamFactory.deploy(
      SWAP_MANAGER_ADDRESS
    )

    await Promise.all([fakeToken.deployed(), paymentStreamFactory.deployed()])

    await paymentStreamFactory.addToken(fakeToken.address, DEX_UNISWAP, [
      USDC_ADDRESS,
      WETH_ADDRESS
    ])
  })

  it('Should create first stream', async function () {
    // to keep things simple fundingAddress will be == payer for testing purposes

    const [fundingAddress, payee] = await ethers.getSigners()

    const blockInfo = await ethers.provider.getBlock('latest')

    const createStreamTx = await paymentStreamFactory.createStream(
      payee.address,
      usdAmount, // usdAmount scaled up to 18 decimals
      fakeToken.address,
      fundingAddress.address,
      blockInfo.timestamp + 86400 * 365 // 1 year
    )

    const { events } = await createStreamTx.wait()

    const event = events.find(newEvent => newEvent.event === 'StreamCreated')

    expect(event.args.id).to.equal(0)
  })

  it('Should get the first stream', async function () {
    const stream = await getStream(0)

    const [fundingAddress, payee] = await ethers.getSigners()

    expect(await stream.fundingAddress()).to.equal(fundingAddress.address)
    expect(await stream.payee()).to.equal(payee.address)
  })

  it('Should get streams count and be 1', async function () {
    const streamsCount = await paymentStreamFactory.getStreamsCount()

    expect(streamsCount).to.equal(1)
  })

  it("Payer should set new funding address to 'thirdGuy' and then back to 'fundingAddress'", async function () {
    const [fundingAddress, , thirdGuy] = await ethers.getSigners()

    const paymentStream = await getStream(0)

    await paymentStream.updateFundingAddress(thirdGuy.address)

    expect(await paymentStream.fundingAddress()).to.equal(thirdGuy.address)

    await paymentStream.updateFundingAddress(fundingAddress.address)
  })

  it('Random person should fail to set new funding address (not the owner)', async function () {
    const [, , , randomPerson] = await ethers.getSigners()

    const paymentStream = await getStream(0)

    const rpPaymentStream = await paymentStream.connect(randomPerson)

    expect(
      rpPaymentStream.updateFundingAddress(randomPerson.address)
    ).to.be.revertedWith('not-stream-owner')
  })

  it('Should return the correct claimable amount', async function () {
    await network.provider.send('evm_increaseTime', [86400]) // +1 day
    await network.provider.send('evm_mine')

    const paymentStream = await getStream(0)

    await paymentStreamFactory.updateOracles(fakeToken.address)

    const claimable = await paymentStream.claimable()
    const claimableToken = await paymentStream.claimableToken()

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
    const paymentStream = await getStream(0)

    fakeToken.approve(paymentStream.address, ethers.utils.parseEther('10000'))
  })

  it('Payee claims his first drip', async function () {
    const [, payee] = await ethers.getSigners()

    const paymentStream = await getStream(0)

    const payeePaymentStream = await paymentStream.connect(payee)

    const initialBalance = await fakeToken.balanceOf(payee.address)

    await payeePaymentStream.claim()

    const afterBalance = await fakeToken.balanceOf(payee.address)

    expect(afterBalance.gt(initialBalance)).to.equal(true)
  })

  it("Random person shouldn't be able to pause the stream", async function () {
    const [, , , randomPerson] = await ethers.getSigners()

    const paymentStream = await getStream(0)

    const rpPaymentStream = await paymentStream.connect(randomPerson)

    expect(rpPaymentStream.pauseStream()).to.be.revertedWith(
      'not-stream-owner-or-delegated'
    )
  })

  it("Payer delegates 'thirdGuy' to pause/unpause stream and checks for paused = true", async function () {
    const [, , thirdGuy] = await ethers.getSigners()

    const paymentStream = await getStream(0)

    await paymentStream.delegatePausable(thirdGuy.address)

    const tgPaymentStream = await paymentStream.connect(thirdGuy)

    await tgPaymentStream.pauseStream()

    expect(await paymentStream.paused()).to.equal(true)
  })

  it('Unpause stream', async function () {
    const [, , thirdGuy] = await ethers.getSigners()

    const paymentStream = await getStream(0)

    const tgPaymentStream = await paymentStream.connect(thirdGuy)

    await tgPaymentStream.unpauseStream()

    expect(await paymentStream.paused()).to.equal(false)
  })

  it('Revokes pausable role', async function () {
    const [, , thirdGuy] = await ethers.getSigners()

    const paymentStream = await getStream(0)

    await paymentStream.revokePausable(thirdGuy.address)

    const tgPaymentStream = await paymentStream.connect(thirdGuy)

    expect(tgPaymentStream.pauseStream()).to.be.revertedWith(
      'not-stream-owner-or-delegated'
    )
  })

  it('Sets the new payee', async function () {
    const [, , , , newPayee] = await ethers.getSigners()

    const paymentStream = await getStream(0)

    await paymentStream.updatePayee(newPayee.address)

    expect(await paymentStream.payee()).to.equal(newPayee.address)
  })

  it('Sets new funding rate', async function () {
    const blockInfo = await ethers.provider.getBlock('latest')
    const deadline = blockInfo.timestamp + 86400 * 7 // 7 days from now

    const paymentStream = await getStream(0)

    const claimable = await paymentStream.claimable()

    const updateFundingRateTx = await paymentStream.updateFundingRate(
      usdAmount,
      deadline
    )

    const { events } = await updateFundingRateTx.wait()

    const event = events.find(newEvent => newEvent.event === 'Claimed')

    expect(event.args.usdAmount.gte(claimable)).to.equal(true)

    expect(
      (await paymentStream.startTime()).add(await paymentStream.secs())
    ).to.equal(deadline)
  })

  it('Payee should be able to claim the full amount after the deadline is expired', async function () {
    await network.provider.send('evm_increaseTime', [86400 * 8]) // +8 day
    await network.provider.send('evm_mine')

    const paymentStream = await getStream(0)

    const claimed = await paymentStream.claimed()
    const claimable = await paymentStream.claimable()

    const expectedClaimable = (await paymentStream.usdAmount()).sub(claimed)

    expect(expectedClaimable).to.equal(claimable)
  })
})
