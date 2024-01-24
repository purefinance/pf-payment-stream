import { expect } from 'chai'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers'
import { time } from '@nomicfoundation/hardhat-network-helpers'

import { PaymentStreamFactory, TestERC20 } from '../typechain-types'
import Address from './address'

const otherToken = Address.mainnet.ERC20Token
const feedRegistry = Address.mainnet.FEED_REGISTRY_ADDRESS
const nativeToken = Address.mainnet.NATIVE_TOKEN

describe('PaymentStreamFactory tests', function () {
  let paymentStreamFactory: PaymentStreamFactory
  let usdAmount: bigint
  let testToken: TestERC20, tokenAddress: string
  let payee: SignerWithAddress, payer: SignerWithAddress, fundingAddress: SignerWithAddress
  let owner: SignerWithAddress

  async function getStream(id: bigint) {
    const streamAddress = await paymentStreamFactory.getStream(id)
    return ethers.getContractAt('PaymentStream', streamAddress)
  }

  before(async function () {
    // eslint-disable-next-line no-extra-semi
    const signers = await ethers.getSigners()
    owner = signers[0]
    payer = fundingAddress = signers[1]
    payee = signers[2]
    usdAmount = ethers.parseEther('100000')
  })

  beforeEach(async function () {
    const erc20Factory = await ethers.getContractFactory('TestERC20')
    testToken = (await erc20Factory.deploy(ethers.parseEther('1000000'))) as TestERC20

    const psfFactory = await ethers.getContractFactory('PaymentStreamFactory')
    paymentStreamFactory = (await psfFactory.deploy(feedRegistry)) as PaymentStreamFactory

    await testToken.connect(owner).transfer(payer, ethers.parseEther('10000'))

    tokenAddress = await testToken.getAddress()
    // Pretends that our deployed fake token is ETH (wETH)
    await paymentStreamFactory.updateCustomFeedMapping(tokenAddress, nativeToken)

    await paymentStreamFactory.updateStalenessTolerance(0)
  })

  describe('Create stream', function () {
    let endTime: number

    beforeEach(async function () {
      endTime = (await time.latest()) + time.duration.days(365)
      paymentStreamFactory = paymentStreamFactory.connect(payer)
    })

    it('should revert when endTime < current time', async function () {
      const invalidEndTime = (await time.latest()) - 1
      const tx = paymentStreamFactory.createStream(payee, usdAmount, tokenAddress, fundingAddress, invalidEndTime)
      await expect(tx).to.revertedWith('invalid-end-time')
    })

    it('should revert when usdAmount = 0', async function () {
      const tx = paymentStreamFactory.createStream(payee, 0, tokenAddress, fundingAddress, endTime)
      await expect(tx).to.be.revertedWith('usd-amount-is-0')
    })

    it('should revert when payee = fundingAddress', async function () {
      const tx = paymentStreamFactory.createStream(payee, usdAmount, tokenAddress, payee, endTime)
      await expect(tx).to.be.revertedWith('payee-is-funding-address')
    })

    it('should revert when payee or fundingAddress is null', async function () {
      // payee is null
      let tx = paymentStreamFactory.createStream(ethers.ZeroAddress, usdAmount, tokenAddress, fundingAddress, endTime)
      await expect(tx).to.be.revertedWith('payee-or-funding-address-is-0')

      // fundingAddress is null
      tx = paymentStreamFactory.createStream(payee, usdAmount, tokenAddress, ethers.ZeroAddress, endTime)
      await expect(tx).to.be.revertedWith('payee-or-funding-address-is-0')
    })

    it('createStream with unsupported token should revert', async function () {
      const tx = paymentStreamFactory.createStream(payee, usdAmount, otherToken, payee, endTime)
      await expect(tx).to.be.revertedWith('Feed not found')
    })

    it('Should create stream', async function () {
      const streamAddress = await paymentStreamFactory.createStream.staticCall(
        payee,
        usdAmount,
        tokenAddress,
        fundingAddress,
        endTime,
      )
      const streamId = await paymentStreamFactory.getStreamsCount()

      const tx = paymentStreamFactory.createStream(payee, usdAmount, tokenAddress, fundingAddress, endTime)
      await expect(tx)
        .emit(paymentStreamFactory, 'StreamCreated')
        .withArgs(streamId, streamAddress, payer, payee, usdAmount)

      const paymentStream = await getStream(streamId)

      expect(await paymentStream.fundingAddress()).equal(fundingAddress)
      expect(await paymentStream.payee()).equal(payee)

      const streamsCount = await paymentStreamFactory.getStreamsCount()
      expect(streamsCount).equal(1)
    })
  })

  describe('updateFeedRegistry', function () {
    it('should revert when zeroAddress is being set', async function () {
      expect(paymentStreamFactory.updateFeedRegistry(ethers.ZeroAddress)).to.be.revertedWith(
        'invalid-feed-registry-address',
      )
    })
    it('should revert when same address is being set', async function () {
      const currentFeedRegistry = await paymentStreamFactory.feedRegistry()
      expect(paymentStreamFactory.updateFeedRegistry(currentFeedRegistry)).to.be.revertedWith(
        'same-feed-registry-address',
      )
    })
    it('should update feed registry', async function () {
      const currentFeedRegistry = await paymentStreamFactory.feedRegistry()
      // Fake address
      const newFeedRegistry = '0xAa7F6f7f507457a1EE157fE97F6c7DB2BEec5cD0'

      expect(paymentStreamFactory.updateFeedRegistry(newFeedRegistry))
        .to.emit(paymentStreamFactory, 'FeedRegistryUpdated')
        .withArgs(currentFeedRegistry, newFeedRegistry)
    })
  })
})
