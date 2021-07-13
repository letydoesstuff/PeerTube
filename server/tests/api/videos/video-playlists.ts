/* eslint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import 'mocha'
import * as chai from 'chai'
import { HttpStatusCode } from '@shared/core-utils'
import {
  checkPlaylistFilesWereRemoved,
  cleanupTests,
  doubleFollow,
  flushAndRunMultipleServers,
  PlaylistsCommand,
  ServerInfo,
  setAccessTokensToServers,
  setDefaultVideoChannel,
  testImage,
  updateVideo,
  uploadVideo,
  uploadVideoAndGetId,
  wait,
  waitJobs
} from '@shared/extra-utils'
import {
  VideoPlaylist,
  VideoPlaylistCreateResult,
  VideoPlaylistElementType,
  VideoPlaylistPrivacy,
  VideoPlaylistType,
  VideoPrivacy
} from '@shared/models'

const expect = chai.expect

async function checkPlaylistElementType (
  servers: ServerInfo[],
  playlistId: string,
  type: VideoPlaylistElementType,
  position: number,
  name: string,
  total: number
) {
  for (const server of servers) {
    const body = await server.playlistsCommand.listVideos({ token: server.accessToken, playlistId, start: 0, count: 10 })
    expect(body.total).to.equal(total)

    const videoElement = body.data.find(e => e.position === position)
    expect(videoElement.type).to.equal(type, 'On server ' + server.url)

    if (type === VideoPlaylistElementType.REGULAR) {
      expect(videoElement.video).to.not.be.null
      expect(videoElement.video.name).to.equal(name)
    } else {
      expect(videoElement.video).to.be.null
    }
  }
}

describe('Test video playlists', function () {
  let servers: ServerInfo[] = []

  let playlistServer2Id1: number
  let playlistServer2Id2: number
  let playlistServer2UUID2: string

  let playlistServer1Id: number
  let playlistServer1UUID: string
  let playlistServer1UUID2: string

  let playlistElementServer1Video4: number
  let playlistElementServer1Video5: number
  let playlistElementNSFW: number

  let nsfwVideoServer1: number

  let userTokenServer1: string

  let commands: PlaylistsCommand[]

  before(async function () {
    this.timeout(120000)

    servers = await flushAndRunMultipleServers(3, { transcoding: { enabled: false } })

    // Get the access tokens
    await setAccessTokensToServers(servers)
    await setDefaultVideoChannel(servers)

    // Server 1 and server 2 follow each other
    await doubleFollow(servers[0], servers[1])
    // Server 1 and server 3 follow each other
    await doubleFollow(servers[0], servers[2])

    commands = servers.map(s => s.playlistsCommand)

    {
      servers[0].videos = []
      servers[1].videos = []
      servers[2].videos = []

      for (const server of servers) {
        for (let i = 0; i < 7; i++) {
          const name = `video ${i} server ${server.serverNumber}`
          const resVideo = await uploadVideo(server.url, server.accessToken, { name, nsfw: false })

          server.videos.push(resVideo.body.video)
        }
      }
    }

    nsfwVideoServer1 = (await uploadVideoAndGetId({ server: servers[0], videoName: 'NSFW video', nsfw: true })).id

    userTokenServer1 = await servers[0].usersCommand.generateUserAndToken('user1')

    await waitJobs(servers)
  })

  describe('Get default playlists', function () {

    it('Should list video playlist privacies', async function () {
      const privacies = await commands[0].getPrivacies()

      expect(Object.keys(privacies)).to.have.length.at.least(3)
      expect(privacies[3]).to.equal('Private')
    })

    it('Should list watch later playlist', async function () {
      const token = servers[0].accessToken

      {
        const body = await commands[0].listByAccount({ token, handle: 'root', playlistType: VideoPlaylistType.WATCH_LATER })

        expect(body.total).to.equal(1)
        expect(body.data).to.have.lengthOf(1)

        const playlist = body.data[0]
        expect(playlist.displayName).to.equal('Watch later')
        expect(playlist.type.id).to.equal(VideoPlaylistType.WATCH_LATER)
        expect(playlist.type.label).to.equal('Watch later')
      }

      {
        const body = await commands[0].listByAccount({ token, handle: 'root', playlistType: VideoPlaylistType.REGULAR })

        expect(body.total).to.equal(0)
        expect(body.data).to.have.lengthOf(0)
      }

      {
        const body = await commands[0].listByAccount({ handle: 'root' })
        expect(body.total).to.equal(0)
        expect(body.data).to.have.lengthOf(0)
      }
    })

    it('Should get private playlist for a classic user', async function () {
      const token = await servers[0].usersCommand.generateUserAndToken('toto')

      const body = await commands[0].listByAccount({ token, handle: 'toto' })

      expect(body.total).to.equal(1)
      expect(body.data).to.have.lengthOf(1)

      const playlistId = body.data[0].id
      await commands[0].listVideos({ token, playlistId })
    })
  })

  describe('Create and federate playlists', function () {

    it('Should create a playlist on server 1 and have the playlist on server 2 and 3', async function () {
      this.timeout(30000)

      await commands[0].create({
        attributes: {
          displayName: 'my super playlist',
          privacy: VideoPlaylistPrivacy.PUBLIC,
          description: 'my super description',
          thumbnailfile: 'thumbnail.jpg',
          videoChannelId: servers[0].videoChannel.id
        }
      })

      await waitJobs(servers)
      // Processing a playlist by the receiver could be long
      await wait(3000)

      for (const server of servers) {
        const body = await server.playlistsCommand.list({ start: 0, count: 5 })
        expect(body.total).to.equal(1)
        expect(body.data).to.have.lengthOf(1)

        const playlistFromList = body.data[0]

        const playlistFromGet = await server.playlistsCommand.get({ playlistId: playlistFromList.uuid })

        for (const playlist of [ playlistFromGet, playlistFromList ]) {
          expect(playlist.id).to.be.a('number')
          expect(playlist.uuid).to.be.a('string')

          expect(playlist.isLocal).to.equal(server.serverNumber === 1)

          expect(playlist.displayName).to.equal('my super playlist')
          expect(playlist.description).to.equal('my super description')
          expect(playlist.privacy.id).to.equal(VideoPlaylistPrivacy.PUBLIC)
          expect(playlist.privacy.label).to.equal('Public')
          expect(playlist.type.id).to.equal(VideoPlaylistType.REGULAR)
          expect(playlist.type.label).to.equal('Regular')
          expect(playlist.embedPath).to.equal('/video-playlists/embed/' + playlist.uuid)

          expect(playlist.videosLength).to.equal(0)

          expect(playlist.ownerAccount.name).to.equal('root')
          expect(playlist.ownerAccount.displayName).to.equal('root')
          expect(playlist.videoChannel.name).to.equal('root_channel')
          expect(playlist.videoChannel.displayName).to.equal('Main root channel')
        }
      }
    })

    it('Should create a playlist on server 2 and have the playlist on server 1 but not on server 3', async function () {
      this.timeout(30000)

      {
        const playlist = await servers[1].playlistsCommand.create({
          attributes: {
            displayName: 'playlist 2',
            privacy: VideoPlaylistPrivacy.PUBLIC,
            videoChannelId: servers[1].videoChannel.id
          }
        })
        playlistServer2Id1 = playlist.id
      }

      {
        const playlist = await servers[1].playlistsCommand.create({
          attributes: {
            displayName: 'playlist 3',
            privacy: VideoPlaylistPrivacy.PUBLIC,
            thumbnailfile: 'thumbnail.jpg',
            videoChannelId: servers[1].videoChannel.id
          }
        })

        playlistServer2Id2 = playlist.id
        playlistServer2UUID2 = playlist.uuid
      }

      for (const id of [ playlistServer2Id1, playlistServer2Id2 ]) {
        await servers[1].playlistsCommand.addElement({
          playlistId: id,
          attributes: { videoId: servers[1].videos[0].id, startTimestamp: 1, stopTimestamp: 2 }
        })
        await servers[1].playlistsCommand.addElement({
          playlistId: id,
          attributes: { videoId: servers[1].videos[1].id }
        })
      }

      await waitJobs(servers)
      await wait(3000)

      for (const server of [ servers[0], servers[1] ]) {
        const body = await server.playlistsCommand.list({ start: 0, count: 5 })

        const playlist2 = body.data.find(p => p.displayName === 'playlist 2')
        expect(playlist2).to.not.be.undefined
        await testImage(server.url, 'thumbnail-playlist', playlist2.thumbnailPath)

        const playlist3 = body.data.find(p => p.displayName === 'playlist 3')
        expect(playlist3).to.not.be.undefined
        await testImage(server.url, 'thumbnail', playlist3.thumbnailPath)
      }

      const body = await servers[2].playlistsCommand.list({ start: 0, count: 5 })
      expect(body.data.find(p => p.displayName === 'playlist 2')).to.be.undefined
      expect(body.data.find(p => p.displayName === 'playlist 3')).to.be.undefined
    })

    it('Should have the playlist on server 3 after a new follow', async function () {
      this.timeout(30000)

      // Server 2 and server 3 follow each other
      await doubleFollow(servers[1], servers[2])

      const body = await servers[2].playlistsCommand.list({ start: 0, count: 5 })

      const playlist2 = body.data.find(p => p.displayName === 'playlist 2')
      expect(playlist2).to.not.be.undefined
      await testImage(servers[2].url, 'thumbnail-playlist', playlist2.thumbnailPath)

      expect(body.data.find(p => p.displayName === 'playlist 3')).to.not.be.undefined
    })
  })

  describe('List playlists', function () {

    it('Should correctly list the playlists', async function () {
      this.timeout(30000)

      {
        const body = await servers[2].playlistsCommand.list({ start: 1, count: 2, sort: 'createdAt' })
        expect(body.total).to.equal(3)

        const data = body.data
        expect(data).to.have.lengthOf(2)
        expect(data[0].displayName).to.equal('playlist 2')
        expect(data[1].displayName).to.equal('playlist 3')
      }

      {
        const body = await servers[2].playlistsCommand.list({ start: 1, count: 2, sort: '-createdAt' })
        expect(body.total).to.equal(3)

        const data = body.data
        expect(data).to.have.lengthOf(2)
        expect(data[0].displayName).to.equal('playlist 2')
        expect(data[1].displayName).to.equal('my super playlist')
      }
    })

    it('Should list video channel playlists', async function () {
      this.timeout(30000)

      {
        const body = await commands[0].listByChannel({ handle: 'root_channel', start: 0, count: 2, sort: '-createdAt' })
        expect(body.total).to.equal(1)

        const data = body.data
        expect(data).to.have.lengthOf(1)
        expect(data[0].displayName).to.equal('my super playlist')
      }
    })

    it('Should list account playlists', async function () {
      this.timeout(30000)

      {
        const body = await servers[1].playlistsCommand.listByAccount({ handle: 'root', start: 1, count: 2, sort: '-createdAt' })
        expect(body.total).to.equal(2)

        const data = body.data
        expect(data).to.have.lengthOf(1)
        expect(data[0].displayName).to.equal('playlist 2')
      }

      {
        const body = await servers[1].playlistsCommand.listByAccount({ handle: 'root', start: 1, count: 2, sort: 'createdAt' })
        expect(body.total).to.equal(2)

        const data = body.data
        expect(data).to.have.lengthOf(1)
        expect(data[0].displayName).to.equal('playlist 3')
      }

      {
        const body = await servers[1].playlistsCommand.listByAccount({ handle: 'root', sort: 'createdAt', search: '3' })
        expect(body.total).to.equal(1)

        const data = body.data
        expect(data).to.have.lengthOf(1)
        expect(data[0].displayName).to.equal('playlist 3')
      }

      {
        const body = await servers[1].playlistsCommand.listByAccount({ handle: 'root', sort: 'createdAt', search: '4' })
        expect(body.total).to.equal(0)

        const data = body.data
        expect(data).to.have.lengthOf(0)
      }
    })
  })

  describe('Playlist rights', function () {
    let unlistedPlaylist: VideoPlaylistCreateResult
    let privatePlaylist: VideoPlaylistCreateResult

    before(async function () {
      this.timeout(30000)

      {
        unlistedPlaylist = await servers[1].playlistsCommand.create({
          attributes: {
            displayName: 'playlist unlisted',
            privacy: VideoPlaylistPrivacy.UNLISTED,
            videoChannelId: servers[1].videoChannel.id
          }
        })
      }

      {
        privatePlaylist = await servers[1].playlistsCommand.create({
          attributes: {
            displayName: 'playlist private',
            privacy: VideoPlaylistPrivacy.PRIVATE
          }
        })
      }

      await waitJobs(servers)
      await wait(3000)
    })

    it('Should not list unlisted or private playlists', async function () {
      for (const server of servers) {
        const results = [
          await server.playlistsCommand.listByAccount({ handle: 'root@localhost:' + servers[1].port, sort: '-createdAt' }),
          await server.playlistsCommand.list({ start: 0, count: 2, sort: '-createdAt' })
        ]

        expect(results[0].total).to.equal(2)
        expect(results[1].total).to.equal(3)

        for (const body of results) {
          const data = body.data
          expect(data).to.have.lengthOf(2)
          expect(data[0].displayName).to.equal('playlist 3')
          expect(data[1].displayName).to.equal('playlist 2')
        }
      }
    })

    it('Should not get unlisted playlist using only the id', async function () {
      await servers[1].playlistsCommand.get({ playlistId: unlistedPlaylist.id, expectedStatus: 404 })
    })

    it('Should get unlisted plyaylist using uuid or shortUUID', async function () {
      await servers[1].playlistsCommand.get({ playlistId: unlistedPlaylist.uuid })
      await servers[1].playlistsCommand.get({ playlistId: unlistedPlaylist.shortUUID })
    })

    it('Should not get private playlist without token', async function () {
      for (const id of [ privatePlaylist.id, privatePlaylist.uuid, privatePlaylist.shortUUID ]) {
        await servers[1].playlistsCommand.get({ playlistId: id, expectedStatus: 401 })
      }
    })

    it('Should get private playlist with a token', async function () {
      for (const id of [ privatePlaylist.id, privatePlaylist.uuid, privatePlaylist.shortUUID ]) {
        await servers[1].playlistsCommand.get({ token: servers[1].accessToken, playlistId: id })
      }
    })
  })

  describe('Update playlists', function () {

    it('Should update a playlist', async function () {
      this.timeout(30000)

      await servers[1].playlistsCommand.update({
        attributes: {
          displayName: 'playlist 3 updated',
          description: 'description updated',
          privacy: VideoPlaylistPrivacy.UNLISTED,
          thumbnailfile: 'thumbnail.jpg',
          videoChannelId: servers[1].videoChannel.id
        },
        playlistId: playlistServer2Id2
      })

      await waitJobs(servers)

      for (const server of servers) {
        const playlist = await server.playlistsCommand.get({ playlistId: playlistServer2UUID2 })

        expect(playlist.displayName).to.equal('playlist 3 updated')
        expect(playlist.description).to.equal('description updated')

        expect(playlist.privacy.id).to.equal(VideoPlaylistPrivacy.UNLISTED)
        expect(playlist.privacy.label).to.equal('Unlisted')

        expect(playlist.type.id).to.equal(VideoPlaylistType.REGULAR)
        expect(playlist.type.label).to.equal('Regular')

        expect(playlist.videosLength).to.equal(2)

        expect(playlist.ownerAccount.name).to.equal('root')
        expect(playlist.ownerAccount.displayName).to.equal('root')
        expect(playlist.videoChannel.name).to.equal('root_channel')
        expect(playlist.videoChannel.displayName).to.equal('Main root channel')
      }
    })
  })

  describe('Element timestamps', function () {

    it('Should create a playlist containing different startTimestamp/endTimestamp videos', async function () {
      this.timeout(30000)

      const addVideo = (attributes: any) => {
        return commands[0].addElement({ playlistId: playlistServer1Id, attributes })
      }

      const playlist = await commands[0].create({
        attributes: {
          displayName: 'playlist 4',
          privacy: VideoPlaylistPrivacy.PUBLIC,
          videoChannelId: servers[0].videoChannel.id
        }
      })

      playlistServer1Id = playlist.id
      playlistServer1UUID = playlist.uuid

      await addVideo({ videoId: servers[0].videos[0].uuid, startTimestamp: 15, stopTimestamp: 28 })
      await addVideo({ videoId: servers[2].videos[1].uuid, startTimestamp: 35 })
      await addVideo({ videoId: servers[2].videos[2].uuid })
      {
        const element = await addVideo({ videoId: servers[0].videos[3].uuid, stopTimestamp: 35 })
        playlistElementServer1Video4 = element.id
      }

      {
        const element = await addVideo({ videoId: servers[0].videos[4].uuid, startTimestamp: 45, stopTimestamp: 60 })
        playlistElementServer1Video5 = element.id
      }

      {
        const element = await addVideo({ videoId: nsfwVideoServer1, startTimestamp: 5 })
        playlistElementNSFW = element.id

        await addVideo({ videoId: nsfwVideoServer1, startTimestamp: 4 })
        await addVideo({ videoId: nsfwVideoServer1 })
      }

      await waitJobs(servers)
    })

    it('Should correctly list playlist videos', async function () {
      this.timeout(30000)

      for (const server of servers) {
        {
          const body = await server.playlistsCommand.listVideos({ playlistId: playlistServer1UUID, start: 0, count: 10 })

          expect(body.total).to.equal(8)

          const videoElements = body.data
          expect(videoElements).to.have.lengthOf(8)

          expect(videoElements[0].video.name).to.equal('video 0 server 1')
          expect(videoElements[0].position).to.equal(1)
          expect(videoElements[0].startTimestamp).to.equal(15)
          expect(videoElements[0].stopTimestamp).to.equal(28)

          expect(videoElements[1].video.name).to.equal('video 1 server 3')
          expect(videoElements[1].position).to.equal(2)
          expect(videoElements[1].startTimestamp).to.equal(35)
          expect(videoElements[1].stopTimestamp).to.be.null

          expect(videoElements[2].video.name).to.equal('video 2 server 3')
          expect(videoElements[2].position).to.equal(3)
          expect(videoElements[2].startTimestamp).to.be.null
          expect(videoElements[2].stopTimestamp).to.be.null

          expect(videoElements[3].video.name).to.equal('video 3 server 1')
          expect(videoElements[3].position).to.equal(4)
          expect(videoElements[3].startTimestamp).to.be.null
          expect(videoElements[3].stopTimestamp).to.equal(35)

          expect(videoElements[4].video.name).to.equal('video 4 server 1')
          expect(videoElements[4].position).to.equal(5)
          expect(videoElements[4].startTimestamp).to.equal(45)
          expect(videoElements[4].stopTimestamp).to.equal(60)

          expect(videoElements[5].video.name).to.equal('NSFW video')
          expect(videoElements[5].position).to.equal(6)
          expect(videoElements[5].startTimestamp).to.equal(5)
          expect(videoElements[5].stopTimestamp).to.be.null

          expect(videoElements[6].video.name).to.equal('NSFW video')
          expect(videoElements[6].position).to.equal(7)
          expect(videoElements[6].startTimestamp).to.equal(4)
          expect(videoElements[6].stopTimestamp).to.be.null

          expect(videoElements[7].video.name).to.equal('NSFW video')
          expect(videoElements[7].position).to.equal(8)
          expect(videoElements[7].startTimestamp).to.be.null
          expect(videoElements[7].stopTimestamp).to.be.null
        }

        {
          const body = await server.playlistsCommand.listVideos({ playlistId: playlistServer1UUID, start: 0, count: 2 })
          expect(body.data).to.have.lengthOf(2)
        }
      }
    })
  })

  describe('Element type', function () {
    let groupUser1: ServerInfo[]
    let groupWithoutToken1: ServerInfo[]
    let group1: ServerInfo[]
    let group2: ServerInfo[]

    let video1: string
    let video2: string
    let video3: string

    before(async function () {
      this.timeout(60000)

      groupUser1 = [ Object.assign({}, servers[0], { accessToken: userTokenServer1 }) ]
      groupWithoutToken1 = [ Object.assign({}, servers[0], { accessToken: undefined }) ]
      group1 = [ servers[0] ]
      group2 = [ servers[1], servers[2] ]

      const playlist = await commands[0].create({
        token: userTokenServer1,
        attributes: {
          displayName: 'playlist 56',
          privacy: VideoPlaylistPrivacy.PUBLIC,
          videoChannelId: servers[0].videoChannel.id
        }
      })

      const playlistServer1Id2 = playlist.id
      playlistServer1UUID2 = playlist.uuid

      const addVideo = (attributes: any) => {
        return commands[0].addElement({ token: userTokenServer1, playlistId: playlistServer1Id2, attributes })
      }

      video1 = (await uploadVideoAndGetId({ server: servers[0], videoName: 'video 89', token: userTokenServer1 })).uuid
      video2 = (await uploadVideoAndGetId({ server: servers[1], videoName: 'video 90' })).uuid
      video3 = (await uploadVideoAndGetId({ server: servers[0], videoName: 'video 91', nsfw: true })).uuid

      await waitJobs(servers)

      await addVideo({ videoId: video1, startTimestamp: 15, stopTimestamp: 28 })
      await addVideo({ videoId: video2, startTimestamp: 35 })
      await addVideo({ videoId: video3 })

      await waitJobs(servers)
    })

    it('Should update the element type if the video is private', async function () {
      this.timeout(20000)

      const name = 'video 89'
      const position = 1

      {
        await updateVideo(servers[0].url, servers[0].accessToken, video1, { privacy: VideoPrivacy.PRIVATE })
        await waitJobs(servers)

        await checkPlaylistElementType(groupUser1, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
        await checkPlaylistElementType(groupWithoutToken1, playlistServer1UUID2, VideoPlaylistElementType.PRIVATE, position, name, 3)
        await checkPlaylistElementType(group1, playlistServer1UUID2, VideoPlaylistElementType.PRIVATE, position, name, 3)
        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.DELETED, position, name, 3)
      }

      {
        await updateVideo(servers[0].url, servers[0].accessToken, video1, { privacy: VideoPrivacy.PUBLIC })
        await waitJobs(servers)

        await checkPlaylistElementType(groupUser1, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
        await checkPlaylistElementType(groupWithoutToken1, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
        await checkPlaylistElementType(group1, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
        // We deleted the video, so even if we recreated it, the old entry is still deleted
        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.DELETED, position, name, 3)
      }
    })

    it('Should update the element type if the video is blacklisted', async function () {
      this.timeout(20000)

      const name = 'video 89'
      const position = 1

      {
        await servers[0].blacklistCommand.add({ videoId: video1, reason: 'reason', unfederate: true })
        await waitJobs(servers)

        await checkPlaylistElementType(groupUser1, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
        await checkPlaylistElementType(groupWithoutToken1, playlistServer1UUID2, VideoPlaylistElementType.UNAVAILABLE, position, name, 3)
        await checkPlaylistElementType(group1, playlistServer1UUID2, VideoPlaylistElementType.UNAVAILABLE, position, name, 3)
        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.DELETED, position, name, 3)
      }

      {
        await servers[0].blacklistCommand.remove({ videoId: video1 })
        await waitJobs(servers)

        await checkPlaylistElementType(groupUser1, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
        await checkPlaylistElementType(groupWithoutToken1, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
        await checkPlaylistElementType(group1, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
        // We deleted the video (because unfederated), so even if we recreated it, the old entry is still deleted
        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.DELETED, position, name, 3)
      }
    })

    it('Should update the element type if the account or server of the video is blocked', async function () {
      this.timeout(90000)

      const command = servers[0].blocklistCommand

      const name = 'video 90'
      const position = 2

      {
        await command.addToMyBlocklist({ token: userTokenServer1, account: 'root@localhost:' + servers[1].port })
        await waitJobs(servers)

        await checkPlaylistElementType(groupUser1, playlistServer1UUID2, VideoPlaylistElementType.UNAVAILABLE, position, name, 3)
        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)

        await command.removeFromMyBlocklist({ token: userTokenServer1, account: 'root@localhost:' + servers[1].port })
        await waitJobs(servers)

        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
      }

      {
        await command.addToMyBlocklist({ token: userTokenServer1, server: 'localhost:' + servers[1].port })
        await waitJobs(servers)

        await checkPlaylistElementType(groupUser1, playlistServer1UUID2, VideoPlaylistElementType.UNAVAILABLE, position, name, 3)
        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)

        await command.removeFromMyBlocklist({ token: userTokenServer1, server: 'localhost:' + servers[1].port })
        await waitJobs(servers)

        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
      }

      {
        await command.addToServerBlocklist({ account: 'root@localhost:' + servers[1].port })
        await waitJobs(servers)

        await checkPlaylistElementType(groupUser1, playlistServer1UUID2, VideoPlaylistElementType.UNAVAILABLE, position, name, 3)
        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)

        await command.removeFromServerBlocklist({ account: 'root@localhost:' + servers[1].port })
        await waitJobs(servers)

        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
      }

      {
        await command.addToServerBlocklist({ server: 'localhost:' + servers[1].port })
        await waitJobs(servers)

        await checkPlaylistElementType(groupUser1, playlistServer1UUID2, VideoPlaylistElementType.UNAVAILABLE, position, name, 3)
        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)

        await command.removeFromServerBlocklist({ server: 'localhost:' + servers[1].port })
        await waitJobs(servers)

        await checkPlaylistElementType(group2, playlistServer1UUID2, VideoPlaylistElementType.REGULAR, position, name, 3)
      }
    })

    it('Should hide the video if it is NSFW', async function () {
      const body = await commands[0].listVideos({ token: userTokenServer1, playlistId: playlistServer1UUID2, query: { nsfw: 'false' } })
      expect(body.total).to.equal(3)

      const elements = body.data
      const element = elements.find(e => e.position === 3)

      expect(element).to.exist
      expect(element.video).to.be.null
      expect(element.type).to.equal(VideoPlaylistElementType.UNAVAILABLE)
    })

  })

  describe('Managing playlist elements', function () {

    it('Should reorder the playlist', async function () {
      this.timeout(30000)

      {
        await commands[0].reorderElements({
          playlistId: playlistServer1Id,
          attributes: {
            startPosition: 2,
            insertAfterPosition: 3
          }
        })

        await waitJobs(servers)

        for (const server of servers) {
          const body = await server.playlistsCommand.listVideos({ playlistId: playlistServer1UUID, start: 0, count: 10 })
          const names = body.data.map(v => v.video.name)

          expect(names).to.deep.equal([
            'video 0 server 1',
            'video 2 server 3',
            'video 1 server 3',
            'video 3 server 1',
            'video 4 server 1',
            'NSFW video',
            'NSFW video',
            'NSFW video'
          ])
        }
      }

      {
        await commands[0].reorderElements({
          playlistId: playlistServer1Id,
          attributes: {
            startPosition: 1,
            reorderLength: 3,
            insertAfterPosition: 4
          }
        })

        await waitJobs(servers)

        for (const server of servers) {
          const body = await server.playlistsCommand.listVideos({ playlistId: playlistServer1UUID, start: 0, count: 10 })
          const names = body.data.map(v => v.video.name)

          expect(names).to.deep.equal([
            'video 3 server 1',
            'video 0 server 1',
            'video 2 server 3',
            'video 1 server 3',
            'video 4 server 1',
            'NSFW video',
            'NSFW video',
            'NSFW video'
          ])
        }
      }

      {
        await commands[0].reorderElements({
          playlistId: playlistServer1Id,
          attributes: {
            startPosition: 6,
            insertAfterPosition: 3
          }
        })

        await waitJobs(servers)

        for (const server of servers) {
          const { data: elements } = await server.playlistsCommand.listVideos({ playlistId: playlistServer1UUID, start: 0, count: 10 })
          const names = elements.map(v => v.video.name)

          expect(names).to.deep.equal([
            'video 3 server 1',
            'video 0 server 1',
            'video 2 server 3',
            'NSFW video',
            'video 1 server 3',
            'video 4 server 1',
            'NSFW video',
            'NSFW video'
          ])

          for (let i = 1; i <= elements.length; i++) {
            expect(elements[i - 1].position).to.equal(i)
          }
        }
      }
    })

    it('Should update startTimestamp/endTimestamp of some elements', async function () {
      this.timeout(30000)

      await commands[0].updateElement({
        playlistId: playlistServer1Id,
        elementId: playlistElementServer1Video4,
        attributes: {
          startTimestamp: 1
        }
      })

      await commands[0].updateElement({
        playlistId: playlistServer1Id,
        elementId: playlistElementServer1Video5,
        attributes: {
          stopTimestamp: null
        }
      })

      await waitJobs(servers)

      for (const server of servers) {
        const { data: elements } = await server.playlistsCommand.listVideos({ playlistId: playlistServer1UUID, start: 0, count: 10 })

        expect(elements[0].video.name).to.equal('video 3 server 1')
        expect(elements[0].position).to.equal(1)
        expect(elements[0].startTimestamp).to.equal(1)
        expect(elements[0].stopTimestamp).to.equal(35)

        expect(elements[5].video.name).to.equal('video 4 server 1')
        expect(elements[5].position).to.equal(6)
        expect(elements[5].startTimestamp).to.equal(45)
        expect(elements[5].stopTimestamp).to.be.null
      }
    })

    it('Should check videos existence in my playlist', async function () {
      const videoIds = [
        servers[0].videos[0].id,
        42000,
        servers[0].videos[3].id,
        43000,
        servers[0].videos[4].id
      ]
      const obj = await commands[0].videosExist({ videoIds })

      {
        const elem = obj[servers[0].videos[0].id]
        expect(elem).to.have.lengthOf(1)
        expect(elem[0].playlistElementId).to.exist
        expect(elem[0].playlistId).to.equal(playlistServer1Id)
        expect(elem[0].startTimestamp).to.equal(15)
        expect(elem[0].stopTimestamp).to.equal(28)
      }

      {
        const elem = obj[servers[0].videos[3].id]
        expect(elem).to.have.lengthOf(1)
        expect(elem[0].playlistElementId).to.equal(playlistElementServer1Video4)
        expect(elem[0].playlistId).to.equal(playlistServer1Id)
        expect(elem[0].startTimestamp).to.equal(1)
        expect(elem[0].stopTimestamp).to.equal(35)
      }

      {
        const elem = obj[servers[0].videos[4].id]
        expect(elem).to.have.lengthOf(1)
        expect(elem[0].playlistId).to.equal(playlistServer1Id)
        expect(elem[0].startTimestamp).to.equal(45)
        expect(elem[0].stopTimestamp).to.equal(null)
      }

      expect(obj[42000]).to.have.lengthOf(0)
      expect(obj[43000]).to.have.lengthOf(0)
    })

    it('Should automatically update updatedAt field of playlists', async function () {
      const server = servers[1]
      const videoId = servers[1].videos[5].id

      async function getPlaylistNames () {
        const { data } = await server.playlistsCommand.listByAccount({ token: server.accessToken, handle: 'root', sort: '-updatedAt' })

        return data.map(p => p.displayName)
      }

      const attributes = { videoId }
      const element1 = await server.playlistsCommand.addElement({ playlistId: playlistServer2Id1, attributes })
      const element2 = await server.playlistsCommand.addElement({ playlistId: playlistServer2Id2, attributes })

      const names1 = await getPlaylistNames()
      expect(names1[0]).to.equal('playlist 3 updated')
      expect(names1[1]).to.equal('playlist 2')

      await server.playlistsCommand.removeElement({ playlistId: playlistServer2Id1, elementId: element1.id })

      const names2 = await getPlaylistNames()
      expect(names2[0]).to.equal('playlist 2')
      expect(names2[1]).to.equal('playlist 3 updated')

      await server.playlistsCommand.removeElement({ playlistId: playlistServer2Id2, elementId: element2.id })

      const names3 = await getPlaylistNames()
      expect(names3[0]).to.equal('playlist 3 updated')
      expect(names3[1]).to.equal('playlist 2')
    })

    it('Should delete some elements', async function () {
      this.timeout(30000)

      await commands[0].removeElement({ playlistId: playlistServer1Id, elementId: playlistElementServer1Video4 })
      await commands[0].removeElement({ playlistId: playlistServer1Id, elementId: playlistElementNSFW })

      await waitJobs(servers)

      for (const server of servers) {
        const body = await server.playlistsCommand.listVideos({ playlistId: playlistServer1UUID, start: 0, count: 10 })
        expect(body.total).to.equal(6)

        const elements = body.data
        expect(elements).to.have.lengthOf(6)

        expect(elements[0].video.name).to.equal('video 0 server 1')
        expect(elements[0].position).to.equal(1)

        expect(elements[1].video.name).to.equal('video 2 server 3')
        expect(elements[1].position).to.equal(2)

        expect(elements[2].video.name).to.equal('video 1 server 3')
        expect(elements[2].position).to.equal(3)

        expect(elements[3].video.name).to.equal('video 4 server 1')
        expect(elements[3].position).to.equal(4)

        expect(elements[4].video.name).to.equal('NSFW video')
        expect(elements[4].position).to.equal(5)

        expect(elements[5].video.name).to.equal('NSFW video')
        expect(elements[5].position).to.equal(6)
      }
    })

    it('Should be able to create a public playlist, and set it to private', async function () {
      this.timeout(30000)

      const videoPlaylistIds = await commands[0].create({
        attributes: {
          displayName: 'my super public playlist',
          privacy: VideoPlaylistPrivacy.PUBLIC,
          videoChannelId: servers[0].videoChannel.id
        }
      })

      await waitJobs(servers)

      for (const server of servers) {
        await server.playlistsCommand.get({ playlistId: videoPlaylistIds.uuid, expectedStatus: HttpStatusCode.OK_200 })
      }

      const attributes = { privacy: VideoPlaylistPrivacy.PRIVATE }
      await commands[0].update({ playlistId: videoPlaylistIds.id, attributes })

      await waitJobs(servers)

      for (const server of [ servers[1], servers[2] ]) {
        await server.playlistsCommand.get({ playlistId: videoPlaylistIds.uuid, expectedStatus: HttpStatusCode.NOT_FOUND_404 })
      }

      await commands[0].get({ playlistId: videoPlaylistIds.uuid, expectedStatus: HttpStatusCode.UNAUTHORIZED_401 })
      await commands[0].get({ token: servers[0].accessToken, playlistId: videoPlaylistIds.uuid, expectedStatus: HttpStatusCode.OK_200 })
    })
  })

  describe('Playlist deletion', function () {

    it('Should delete the playlist on server 1 and delete on server 2 and 3', async function () {
      this.timeout(30000)

      await commands[0].delete({ playlistId: playlistServer1Id })

      await waitJobs(servers)

      for (const server of servers) {
        await server.playlistsCommand.get({ playlistId: playlistServer1UUID, expectedStatus: HttpStatusCode.NOT_FOUND_404 })
      }
    })

    it('Should have deleted the thumbnail on server 1, 2 and 3', async function () {
      this.timeout(30000)

      for (const server of servers) {
        await checkPlaylistFilesWereRemoved(playlistServer1UUID, server.internalServerNumber)
      }
    })

    it('Should unfollow servers 1 and 2 and hide their playlists', async function () {
      this.timeout(30000)

      const finder = (data: VideoPlaylist[]) => data.find(p => p.displayName === 'my super playlist')

      {
        const body = await servers[2].playlistsCommand.list({ start: 0, count: 5 })
        expect(body.total).to.equal(3)

        expect(finder(body.data)).to.not.be.undefined
      }

      await servers[2].followsCommand.unfollow({ target: servers[0] })

      {
        const body = await servers[2].playlistsCommand.list({ start: 0, count: 5 })
        expect(body.total).to.equal(1)

        expect(finder(body.data)).to.be.undefined
      }
    })

    it('Should delete a channel and put the associated playlist in private mode', async function () {
      this.timeout(30000)

      const channel = await servers[0].channelsCommand.create({ attributes: { name: 'super_channel', displayName: 'super channel' } })

      const playlistCreated = await commands[0].create({
        attributes: {
          displayName: 'channel playlist',
          privacy: VideoPlaylistPrivacy.PUBLIC,
          videoChannelId: channel.id
        }
      })

      await waitJobs(servers)

      await servers[0].channelsCommand.delete({ channelName: 'super_channel' })

      await waitJobs(servers)

      const body = await commands[0].get({ token: servers[0].accessToken, playlistId: playlistCreated.uuid })
      expect(body.displayName).to.equal('channel playlist')
      expect(body.privacy.id).to.equal(VideoPlaylistPrivacy.PRIVATE)

      await servers[1].playlistsCommand.get({ playlistId: playlistCreated.uuid, expectedStatus: HttpStatusCode.NOT_FOUND_404 })
    })

    it('Should delete an account and delete its playlists', async function () {
      this.timeout(30000)

      const { userId, token } = await servers[0].usersCommand.generate('user_1')

      const { videoChannels } = await servers[0].usersCommand.getMyInfo({ token })
      const userChannel = videoChannels[0]

      await commands[0].create({
        attributes: {
          displayName: 'playlist to be deleted',
          privacy: VideoPlaylistPrivacy.PUBLIC,
          videoChannelId: userChannel.id
        }
      })

      await waitJobs(servers)

      const finder = (data: VideoPlaylist[]) => data.find(p => p.displayName === 'playlist to be deleted')

      {
        for (const server of [ servers[0], servers[1] ]) {
          const body = await server.playlistsCommand.list({ start: 0, count: 15 })

          expect(finder(body.data)).to.not.be.undefined
        }
      }

      await servers[0].usersCommand.remove({ userId })
      await waitJobs(servers)

      {
        for (const server of [ servers[0], servers[1] ]) {
          const body = await server.playlistsCommand.list({ start: 0, count: 15 })

          expect(finder(body.data)).to.be.undefined
        }
      }
    })
  })

  after(async function () {
    await cleanupTests(servers)
  })
})
