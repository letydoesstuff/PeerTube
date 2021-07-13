/* eslint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import 'mocha'
import * as chai from 'chai'
import {
  BulkCommand,
  cleanupTests,
  doubleFollow,
  flushAndRunMultipleServers,
  getVideosList,
  ServerInfo,
  setAccessTokensToServers,
  uploadVideo,
  waitJobs
} from '@shared/extra-utils'
import { Video } from '@shared/models'

const expect = chai.expect

describe('Test bulk actions', function () {
  const commentsUser3: { videoId: number, commentId: number }[] = []

  let servers: ServerInfo[] = []
  let user1Token: string
  let user2Token: string
  let user3Token: string

  let bulkCommand: BulkCommand

  before(async function () {
    this.timeout(30000)

    servers = await flushAndRunMultipleServers(2)

    // Get the access tokens
    await setAccessTokensToServers(servers)

    {
      const user = { username: 'user1', password: 'password' }
      await servers[0].usersCommand.create({ username: user.username, password: user.password })

      user1Token = await servers[0].loginCommand.getAccessToken(user)
    }

    {
      const user = { username: 'user2', password: 'password' }
      await servers[0].usersCommand.create({ username: user.username, password: user.password })

      user2Token = await servers[0].loginCommand.getAccessToken(user)
    }

    {
      const user = { username: 'user3', password: 'password' }
      await servers[1].usersCommand.create({ username: user.username, password: user.password })

      user3Token = await servers[1].loginCommand.getAccessToken(user)
    }

    await doubleFollow(servers[0], servers[1])

    bulkCommand = new BulkCommand(servers[0])
  })

  describe('Bulk remove comments', function () {
    async function checkInstanceCommentsRemoved () {
      {
        const res = await getVideosList(servers[0].url)
        const videos = res.body.data as Video[]

        // Server 1 should not have these comments anymore
        for (const video of videos) {
          const { data } = await servers[0].commentsCommand.listThreads({ videoId: video.id })
          const comment = data.find(c => c.text === 'comment by user 3')

          expect(comment).to.not.exist
        }
      }

      {
        const res = await getVideosList(servers[1].url)
        const videos = res.body.data as Video[]

        // Server 1 should not have these comments on videos of server 1
        for (const video of videos) {
          const { data } = await servers[1].commentsCommand.listThreads({ videoId: video.id })
          const comment = data.find(c => c.text === 'comment by user 3')

          if (video.account.host === 'localhost:' + servers[0].port) {
            expect(comment).to.not.exist
          } else {
            expect(comment).to.exist
          }
        }
      }
    }

    before(async function () {
      this.timeout(120000)

      await uploadVideo(servers[0].url, servers[0].accessToken, { name: 'video 1 server 1' })
      await uploadVideo(servers[0].url, servers[0].accessToken, { name: 'video 2 server 1' })
      await uploadVideo(servers[0].url, user1Token, { name: 'video 3 server 1' })

      await uploadVideo(servers[1].url, servers[1].accessToken, { name: 'video 1 server 2' })

      await waitJobs(servers)

      {
        const res = await getVideosList(servers[0].url)
        for (const video of res.body.data) {
          await servers[0].commentsCommand.createThread({ videoId: video.id, text: 'comment by root server 1' })
          await servers[0].commentsCommand.createThread({ token: user1Token, videoId: video.id, text: 'comment by user 1' })
          await servers[0].commentsCommand.createThread({ token: user2Token, videoId: video.id, text: 'comment by user 2' })
        }
      }

      {
        const res = await getVideosList(servers[1].url)

        for (const video of res.body.data) {
          await servers[1].commentsCommand.createThread({ videoId: video.id, text: 'comment by root server 2' })

          const comment = await servers[1].commentsCommand.createThread({ token: user3Token, videoId: video.id, text: 'comment by user 3' })
          commentsUser3.push({ videoId: video.id, commentId: comment.id })
        }
      }

      await waitJobs(servers)
    })

    it('Should delete comments of an account on my videos', async function () {
      this.timeout(60000)

      await bulkCommand.removeCommentsOf({
        token: user1Token,
        attributes: {
          accountName: 'user2',
          scope: 'my-videos'
        }
      })

      await waitJobs(servers)

      for (const server of servers) {
        const res = await getVideosList(server.url)

        for (const video of res.body.data) {
          const { data } = await server.commentsCommand.listThreads({ videoId: video.id })
          const comment = data.find(c => c.text === 'comment by user 2')

          if (video.name === 'video 3 server 1') expect(comment).to.not.exist
          else expect(comment).to.exist
        }
      }
    })

    it('Should delete comments of an account on the instance', async function () {
      this.timeout(60000)

      await bulkCommand.removeCommentsOf({
        attributes: {
          accountName: 'user3@localhost:' + servers[1].port,
          scope: 'instance'
        }
      })

      await waitJobs(servers)

      await checkInstanceCommentsRemoved()
    })

    it('Should not re create the comment on video update', async function () {
      this.timeout(60000)

      for (const obj of commentsUser3) {
        await servers[1].commentsCommand.addReply({
          token: user3Token,
          videoId: obj.videoId,
          toCommentId: obj.commentId,
          text: 'comment by user 3 bis'
        })
      }

      await waitJobs(servers)

      await checkInstanceCommentsRemoved()
    })
  })

  after(async function () {
    await cleanupTests(servers)
  })
})
