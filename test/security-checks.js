'use strict'

const { expect } = require('chai')
const { ethers } = require('hardhat')

const FEED_REGISTRY_ADDRESS = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf'
const VSP_ADDRESS = '0x1b40183EFB4Dd766f11bDa7A7c3AD8982e998421'
const WBTC_ADDRESS = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

const usdAmount = ethers.utils.parseEther('100000')

describe('Security checks', function () {
  let paymentStreamFactory
  let fakeToken

  before(async function () {
    const FakeERC20 = await ethers.getContractFactory('FakeERC20')
    fakeToken = await FakeERC20.deploy(ethers.utils.parseEther('1000000'))

    const PaymentStreamFactory = await ethers.getContractFactory(
      'PaymentStreamFactory'
    )
    paymentStreamFactory = await PaymentStreamFactory.deploy(
      FEED_REGISTRY_ADDRESS
    )

    await Promise.all([fakeToken.deployed(), paymentStreamFactory.deployed()])

    // Pretends that our deployed fake token is VSP
    await paymentStreamFactory.updateCustomFeedMapping(
      fakeToken.address,
      VSP_ADDRESS
    )

    await paymentStreamFactory.updateStalenessTolerance(0)
  })

  describe('createStream', function () {
    it('endTime < current time should revert', async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        payee.address,
        usdAmount,
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp - 1
      )

      expect(createStreamTx).to.be.revertedWith('invalid-end-time')
    })

    it('usdAmount = 0 should revert', async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        payee.address,
        0,
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('usd-amount-is-0')
    })

    it('payee = fundingAddress should revert', async function () {
      const [, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        payee.address,
        usdAmount,
        fakeToken.address,
        payee.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('payee-is-funding-address')
    })

    it('payee and fundingAddress cannot be null', async function () {
      const [fundingAddress] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        ethers.constants.AddressZero,
        usdAmount,
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('payee-or-funding-address-is-0')
    })

    it('createStream with unsupported token should revert', async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        payee.address,
        usdAmount,
        WBTC_ADDRESS,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('Feed not found')
    })
  })

  describe('claim', function () {
    let streamId
    let paymentStream

    before(async function () {
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

      streamId = event.args.id

      const streamAddress = await paymentStreamFactory.getStream(streamId)

      paymentStream = await ethers.getContractAt('PaymentStream', streamAddress)
    })

    it('Claiming on paused stream should revert', async function () {
      const [, payee] = await ethers.getSigners()

      await paymentStream.pauseStream()

      const payeePaymentStream = await paymentStream.connect(payee)

      const claimTx = payeePaymentStream.claim()

      expect(claimTx).to.be.revertedWith('stream-is-paused')

      await paymentStream.unpauseStream()
    })

    it('Claiming from non-payee should revert', async function () {
      const [, , nonPayee] = await ethers.getSigners()

      const nonPayeePaymentStream = await paymentStream.connect(nonPayee)

      const claimTx = nonPayeePaymentStream.claim()

      expect(claimTx).to.be.revertedWith('not-payee')
    })
  })

  describe('Editing a stream', function () {
    let streamId
    let paymentStream

    before(async function () {
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

      streamId = event.args.id

      const streamAddress = await paymentStreamFactory.getStream(streamId)

      paymentStream = await ethers.getContractAt('PaymentStream', streamAddress)
    })

    describe('delegatePausable', function () {
      it('Delegating to invalid address should revert', async function () {
        const check = paymentStream.delegatePausable(
          ethers.constants.AddressZero
        )

        expect(check).to.be.revertedWith('invalid-delegate')
      })
    })

    describe('updateFundingAddress', function () {
      it('Setting an invalid funding address should revert', async function () {
        const currentFundingAddress = await paymentStream.fundingAddress()
        expect(
          paymentStream.updateFundingAddress(ethers.constants.AddressZero)
        ).to.be.revertedWith('invalid-new-funding-address')
        expect(
          paymentStream.updateFundingAddress(currentFundingAddress)
        ).to.be.revertedWith('same-new-funding-address')
      })
    })

    describe('updatePayee', function () {
      it('Setting an invalid payee address should revert', async function () {
        const currentPayee = await paymentStream.payee()
        expect(
          paymentStream.updatePayee(ethers.constants.AddressZero)
        ).to.be.revertedWith('invalid-new-payee')
        expect(paymentStream.updatePayee(currentPayee)).to.be.revertedWith(
          'same-new-payee'
        )
      })
    })

    describe('updateFundingRate', function () {
      it('endTime < current time should revert', async function () {
        const blockInfo = await ethers.provider.getBlock('latest')

        const check = paymentStream.updateFundingRate(
          usdAmount,
          blockInfo.timestamp - 86400
        )

        expect(check).to.be.revertedWith('invalid-end-time')
      })
    })

    describe('updateFeedRegistry', function () {
      it('Setting 0 address should revert', async function () {
        expect(
          paymentStreamFactory.updateFeedRegistry(
            '0x0000000000000000000000000000000000000000'
          )
        ).to.be.revertedWith('invalid-feed-registry-address')
      })
      it('Setting the same address should revert', async function () {
        expect(
          paymentStreamFactory.updateFeedRegistry(FEED_REGISTRY_ADDRESS)
        ).to.be.revertedWith('same-feed-registry-address')
      })
      it('Setting SwapManager address should emit an event', async function () {
        const NEW_FEED_REGISTRY_ADDRESS =
          '0xAa7F6f7f507457a1EE157fE97F6c7DB2BEec5cD0'

        expect(
          paymentStreamFactory.updateFeedRegistry(NEW_FEED_REGISTRY_ADDRESS)
        )
          .to.emit(paymentStreamFactory, 'FeedRegistryUpdated')
          .withArgs(FEED_REGISTRY_ADDRESS, NEW_FEED_REGISTRY_ADDRESS)
      })
    })
  })
})
