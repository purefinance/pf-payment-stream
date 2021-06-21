'use strict'

const { expect } = require('chai')
const { ethers, network } = require('hardhat')

const SWAP_MANAGER_ADDRESS = '0xC48ea9A2daA4d816e4c9333D6689C70070010174'

const DEX_UNISWAP = 0

const VSP_ADDRESS = '0x1b40183EFB4Dd766f11bDa7A7c3AD8982e998421'
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const usdAmount = ethers.utils.parseEther('100000')

describe('Security checks', function () {
  let paymentStream
  let fakeToken

  before(async function () {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.NODE_URL
          }
        }
      ]
    })

    const FakeERC20 = await ethers.getContractFactory('FakeERC20')
    fakeToken = await FakeERC20.deploy(ethers.utils.parseEther('1000000'))

    const PaymentStream = await ethers.getContractFactory('PaymentStream')
    paymentStream = await PaymentStream.deploy(SWAP_MANAGER_ADDRESS)

    await Promise.all([fakeToken.deployed(), paymentStream.deployed()])

    await paymentStream.addToken(fakeToken.address, DEX_UNISWAP, [
      USDC_ADDRESS,
      WETH_ADDRESS,
      VSP_ADDRESS
    ])
  })

  describe('createStream', function () {
    it('endTime < current time should revert', async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStream.createStream(
        payee.address,
        usdAmount,
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp - 1
      )

      expect(createStreamTx).to.be.revertedWith('End time is in the past')
    })

    it('usdAmount = 0 should revert', async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStream.createStream(
        payee.address,
        0,
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('usdAmount == 0')
    })

    it('payee = fundingAddress should revert', async function () {
      const [, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStream.createStream(
        payee.address,
        usdAmount,
        fakeToken.address,
        payee.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('payee == fundingAddress')
    })

    it('payee and fundingAddress cannot be null', async function () {
      const [fundingAddress] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStream.createStream(
        ethers.constants.AddressZero,
        usdAmount,
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith(
        'invalid payee or fundingAddress'
      )
    })

    it('createStream with unsupported token should revert', async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStream.createStream(
        payee.address,
        usdAmount,
        VSP_ADDRESS,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('Token not supported')
    })
  })

  describe('claim', function () {
    let streamId

    before(async function () {
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

      streamId = event.args.id
    })

    it('Claiming on paused stream should revert', async function () {
      const [, payee] = await ethers.getSigners()

      await paymentStream.pauseStream(streamId)

      const payeePaymentStream = await paymentStream.connect(payee)

      const claimTx = payeePaymentStream.claim(streamId)

      expect(claimTx).to.be.revertedWith('Stream is paused')
    })

    it('Claiming from non-payee should revert', async function () {
      const [, , nonPayee] = await ethers.getSigners()

      const nonPayeePaymentStream = await paymentStream.connect(nonPayee)

      const claimTx = nonPayeePaymentStream.claim(streamId)

      expect(claimTx).to.be.revertedWith('Not payee')
    })
  })

  describe('Editing a stream', function () {
    let streamId

    before(async function () {
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

      streamId = event.args.id
    })

    describe('delegatePausable', function () {
      it('Delegating to invalid address should revert', async function () {
        const check = paymentStream.delegatePausable(
          streamId,
          ethers.constants.AddressZero
        )

        expect(check).to.be.revertedWith('Invalid delegate')
      })
    })

    describe('updateFundingAddress', function () {
      it('Setting an invalid funding address should revert', async function () {
        const check = paymentStream.updateFundingAddress(
          streamId,
          ethers.constants.AddressZero
        )

        expect(check).to.be.revertedWith('newFundingAddress invalid')
      })
    })

    describe('updatePayee', function () {
      it('Setting an invalid payee address should revert', async function () {
        const check = paymentStream.updatePayee(
          streamId,
          ethers.constants.AddressZero
        )

        expect(check).to.be.revertedWith('newPayee invalid')
      })
    })

    describe('updateFundingRate', function () {
      it('endTime < current time should revert', async function () {
        const blockInfo = await ethers.provider.getBlock('latest')

        const check = paymentStream.updateFundingRate(
          streamId,
          usdAmount,
          blockInfo.timestamp - 86400
        )

        expect(check).to.be.revertedWith('End time is in the past')
      })
    })

    describe('updateSwapManager', function () {
      it('Setting 0 address should revert', async function () {
        expect(
          paymentStream.updateSwapManager(
            '0x0000000000000000000000000000000000000000'
          )
        ).to.be.revertedWith('Invalid SwapManager address')
      })
      it('Setting SwapManager address should emit an event', async function () {
        expect(paymentStream.updateSwapManager(SWAP_MANAGER_ADDRESS))
          .to.emit(paymentStream, 'SwapManagerUpdated')
          .withArgs(SWAP_MANAGER_ADDRESS, SWAP_MANAGER_ADDRESS)
      })
    })
  })
})
