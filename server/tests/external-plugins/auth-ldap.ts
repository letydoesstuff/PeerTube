/* eslint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import 'mocha'
import { expect } from 'chai'
import { HttpStatusCode } from '@shared/core-utils'
import { cleanupTests, flushAndRunServer, ServerInfo, setAccessTokensToServers, uploadVideo } from '@shared/extra-utils'

describe('Official plugin auth-ldap', function () {
  let server: ServerInfo
  let accessToken: string
  let userId: number

  before(async function () {
    this.timeout(30000)

    server = await flushAndRunServer(1)
    await setAccessTokensToServers([ server ])

    await server.pluginsCommand.install({ npmName: 'peertube-plugin-auth-ldap' })
  })

  it('Should not login with without LDAP settings', async function () {
    await server.loginCommand.login({ user: { username: 'fry', password: 'fry' }, expectedStatus: HttpStatusCode.BAD_REQUEST_400 })
  })

  it('Should not login with bad LDAP settings', async function () {
    await server.pluginsCommand.updateSettings({
      npmName: 'peertube-plugin-auth-ldap',
      settings: {
        'bind-credentials': 'GoodNewsEveryone',
        'bind-dn': 'cn=admin,dc=planetexpress,dc=com',
        'insecure-tls': false,
        'mail-property': 'mail',
        'search-base': 'ou=people,dc=planetexpress,dc=com',
        'search-filter': '(|(mail={{username}})(uid={{username}}))',
        'url': 'ldap://localhost:390',
        'username-property': 'uid'
      }
    })

    await server.loginCommand.login({ user: { username: 'fry', password: 'fry' }, expectedStatus: HttpStatusCode.BAD_REQUEST_400 })
  })

  it('Should not login with good LDAP settings but wrong username/password', async function () {
    await server.pluginsCommand.updateSettings({
      npmName: 'peertube-plugin-auth-ldap',
      settings: {
        'bind-credentials': 'GoodNewsEveryone',
        'bind-dn': 'cn=admin,dc=planetexpress,dc=com',
        'insecure-tls': false,
        'mail-property': 'mail',
        'search-base': 'ou=people,dc=planetexpress,dc=com',
        'search-filter': '(|(mail={{username}})(uid={{username}}))',
        'url': 'ldap://localhost:10389',
        'username-property': 'uid'
      }
    })

    await server.loginCommand.login({ user: { username: 'fry', password: 'bad password' }, expectedStatus: HttpStatusCode.BAD_REQUEST_400 })
    await server.loginCommand.login({ user: { username: 'fryr', password: 'fry' }, expectedStatus: HttpStatusCode.BAD_REQUEST_400 })
  })

  it('Should login with the appropriate username/password', async function () {
    accessToken = await server.loginCommand.getAccessToken({ username: 'fry', password: 'fry' })
  })

  it('Should login with the appropriate email/password', async function () {
    accessToken = await server.loginCommand.getAccessToken({ username: 'fry@planetexpress.com', password: 'fry' })
  })

  it('Should login get my profile', async function () {
    const body = await server.usersCommand.getMyInfo({ token: accessToken })
    expect(body.username).to.equal('fry')
    expect(body.email).to.equal('fry@planetexpress.com')

    userId = body.id
  })

  it('Should upload a video', async function () {
    await uploadVideo(server.url, accessToken, { name: 'my super video' })
  })

  it('Should not be able to login if the user is banned', async function () {
    await server.usersCommand.banUser({ userId })

    await server.loginCommand.login({
      user: { username: 'fry@planetexpress.com', password: 'fry' },
      expectedStatus: HttpStatusCode.BAD_REQUEST_400
    })
  })

  it('Should be able to login if the user is unbanned', async function () {
    await server.usersCommand.unbanUser({ userId })

    await server.loginCommand.login({ user: { username: 'fry@planetexpress.com', password: 'fry' } })
  })

  it('Should not login if the plugin is uninstalled', async function () {
    await server.pluginsCommand.uninstall({ npmName: 'peertube-plugin-auth-ldap' })

    await server.loginCommand.login({
      user: { username: 'fry@planetexpress.com', password: 'fry' },
      expectedStatus: HttpStatusCode.BAD_REQUEST_400
    })
  })

  after(async function () {
    await cleanupTests([ server ])
  })
})
