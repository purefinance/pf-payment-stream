import { expect } from 'chai'
import axios from 'axios'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers'
import { time } from '@nomicfoundation/hardhat-network-helpers'

import { PaymentStream, PaymentStreamFactory, TestERC20 } from '../typechain-types'
import Address from './address'

const feedRegistry = Address.mainnet.FEED_REGISTRY_ADDRESS
const nativeToken = Address.mainnet.NATIVE_TOKEN

async function ethToUsd(amount: bigint) {
  /*
   * Performs an off-chain lookup of ether amount in usd scaled to 18 decimals
   */
  const ETHERSCAN_API = 'https://api.etherscan.io/api?module=stats&action=ethprice'

  const { data } = await axios.get(ETHERSCAN_API)
  const { ethusd } = data.result

  return amount * BigInt(parseInt(ethusd))
}

describe('PaymentStream tests', function () {
  let paymentStreamFactory: PaymentStreamFactory
  let usdAmount: bigint
  let testToken: TestERC20, tokenAddress: string
  let payee: SignerWithAddress, payer: SignerWithAddress, fundingAddress: SignerWithAddress
  let owner: SignerWithAddress, user1: SignerWithAddress
  let streamId: bigint
  let paymentStream: PaymentStream

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
    user1 = signers[3]
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

    const endTime = (await time.latest()) + time.duration.days(365)
    streamId = await paymentStreamFactory.getStreamsCount()
    await paymentStreamFactory.createStream(payee, usdAmount, tokenAddress, fundingAddress, endTime)

    paymentStream = await getStream(streamId)
    // fundingAddress approves
    testToken.connect(payer).approve(await paymentStream.getAddress(), ethers.parseEther('10000'))
  })

  describe('Claim', function () {
    it('Should return the correct claimable amount after one day', async function () {
      await time.increase(time.duration.days(1))

      const claimable = await paymentStream.claimable()
      const afterOneDay = usdAmount / 365n
      // Claimable is +-5% of expected
      expect(claimable).closeTo(afterOneDay, (afterOneDay * 5n) / 100n)

      // Checks if on-chain token amount is in line with the off-chain usd value
      const claimableToken = await paymentStream.claimableToken()
      const offChainUsdValue = await ethToUsd(claimableToken)

      expect(claimable).closeTo(offChainUsdValue, (offChainUsdValue * 10n) / 100n)
    })

    it('should allow payee to claim', async function () {
      const balanceBefore = await testToken.balanceOf(payee)

      await paymentStream.connect(payee).claim()

      const balanceAfter = await testToken.balanceOf(payee)
      expect(balanceAfter).gt(balanceBefore)
    })

    it('should claim full amount after maturity', async function () {
      await time.increase(time.duration.days(366)) // Maturity + 1 day
      const claimable = await paymentStream.claimable()
      expect(claimable).eq(usdAmount)
      const claimableToken = await paymentStream.claimableToken()
      const balanceBefore = await testToken.balanceOf(payee)

      await paymentStream.connect(payee).claim()

      const balanceAfter = await testToken.balanceOf(payee)
      expect(balanceAfter - balanceBefore).eq(claimableToken)
      expect(await paymentStream.claimable()).eq(0)
      expect(await paymentStream.claimableToken()).eq(0)
    })

    it('Claiming on paused stream should revert', async function () {
      await paymentStream.pauseStream()
      const claimTx = paymentStream.connect(payee).claim()
      await expect(claimTx).to.be.revertedWith('stream-is-paused')
    })

    it('Claiming from non-payee should revert', async function () {
      const claimTx = paymentStream.connect(user1).claim()
      await expect(claimTx).to.be.revertedWith('not-payee')
    })

    it('Payee should not be able to claim drip if the oracle is stale', async function () {
      // Sets tolerance to 1 hour
      await paymentStreamFactory.updateStalenessTolerance(time.duration.hours(1))
      await time.increase(time.duration.hours(1))

      await expect(paymentStream.connect(payee).claim()).to.be.revertedWith('stale-oracle')
    })
  })

  describe('Update stream', function () {
    describe('pause/unpause', function () {
      it('should revert if non-owner calls pause', async function () {
        await expect(paymentStream.connect(user1).pauseStream()).be.revertedWith('not-stream-owner-or-delegated')
      })

      it('should revert when setting invalid address as delegate', async function () {
        await expect(paymentStream.delegatePausable(ethers.ZeroAddress)).to.be.revertedWith('invalid-delegate')
      })

      it('should allow delegate to pause/unpause stream', async function () {
        // given
        await paymentStream.delegatePausable(user1)
        // when
        await paymentStream.connect(user1).pauseStream()
        // then
        expect(await paymentStream.paused()).true

        // when
        await paymentStream.connect(user1).unpauseStream()
        //then
        expect(await paymentStream.paused()).false
      })
    })

    describe('updateFundingAddress', function () {
      it('should revert when non-payer call setFundingAddress', async function () {
        await expect(paymentStream.connect(payee).updateFundingAddress(user1)).be.revertedWith('not-stream-owner')
      })

      it('should revert when setting invalid address as fundingAddress', async function () {
        await expect(paymentStream.updateFundingAddress(ethers.ZeroAddress)).to.be.revertedWith(
          'invalid-new-funding-address',
        )

        await expect(paymentStream.updateFundingAddress(await paymentStream.fundingAddress())).to.revertedWith(
          'same-new-funding-address',
        )
      })

      it('should allow payer to set new funding address', async function () {
        await paymentStream.updateFundingAddress(user1)
        expect(await paymentStream.fundingAddress()).equal(user1)
      })
    })

    describe('updatePayee', function () {
      it('should revert when setting invalid address as payee', async function () {
        await expect(paymentStream.updatePayee(ethers.ZeroAddress)).to.be.revertedWith('invalid-new-payee')
        await expect(paymentStream.updatePayee(await paymentStream.payee())).to.be.revertedWith('same-new-payee')
      })

      it('should allow payer to set new payee', async function () {
        const currentPayee = await paymentStream.payee()
        const balanceBefore = await testToken.balanceOf(currentPayee)

        await paymentStream.updatePayee(user1)
        const balanceAfter = await testToken.balanceOf(currentPayee)
        expect(balanceAfter).to.gt(balanceBefore)

        expect(await paymentStream.payee()).to.eq(user1)
        expect(await paymentStream.claimable()).to.eq(0)
      })
    })

    describe('updateFundingRate', function () {
      it('should revert when endTime < current time', async function () {
        await expect(paymentStream.updateFundingRate(usdAmount, (await time.latest()) - 1)).to.be.revertedWith(
          'invalid-end-time',
        )
      })

      it('should allow payer to set new funding rate', async function () {
        const deadline = (await time.latest()) + time.duration.days(7)
        const balanceBefore = await testToken.balanceOf(payee)

        // Update should trigger claim as well
        const tx = paymentStream.updateFundingRate(usdAmount, deadline)

        await expect(tx).to.emit(paymentStream, 'Claimed')
        expect(await testToken.balanceOf(payee)).gt(balanceBefore)

        const secs = await paymentStream.secs()
        const startTime = await paymentStream.startTime()
        expect(startTime + secs).lte(deadline)
      })
    })
  })
})
