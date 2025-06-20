import { browserSleep, findParentElement, go } from '../utils'

export class VideoListPage {
  constructor (private isMobileDevice: boolean, private isSafari: boolean) {
  }

  async goOnVideosList () {
    let url: string

    // We did not upload a file on a mobile device
    if (this.isMobileDevice === true || this.isSafari === true) {
      url = 'https://peertube2.cpy.re/videos/browse?scope=local'
    } else {
      url = '/videos/browse'
    }

    await go(url)

    // Waiting the following element does not work on Safari...
    if (this.isSafari) return browserSleep(3000)

    await this.waitForList()
  }

  async goOnBrowseVideos () {
    await $('.menu-link*=Home').click()

    const browseVideos = $('a*=Browse videos')
    await browseVideos.waitForClickable()
    await browseVideos.click()
    await this.waitForList()
  }

  async goOnHomepage () {
    await go('/home')
    await this.waitForList()
  }

  async goOnRootChannel () {
    await go('/c/root_channel/videos')
    await this.waitForList()
  }

  async goOnRootAccount () {
    await go('/a/root/videos')
    await this.waitForList()
  }

  async goOnRootAccountChannels () {
    await go('/a/root/video-channels')
    await this.waitForList()
  }

  async getNSFWFilterText () {
    const el = $('.active-filter*=Sensitive')

    await el.waitForDisplayed()

    return el.getText()
  }

  async getVideosListName () {
    const elems = $$('.videos .video-miniature .video-name')
    const texts = await elems.map(e => e.getText())

    return texts.map(t => t.trim())
  }

  isVideoDisplayed (name: string) {
    return $('.video-name=' + name).isDisplayed()
  }

  async isVideoBlurred (name: string) {
    const miniature = await this.getVideoMiniature(name)
    const filter = await miniature.$('my-video-thumbnail img').getCSSProperty('filter')

    return filter.value !== 'none'
  }

  async hasVideoWarning (name: string) {
    const miniature = await this.getVideoMiniature(name)

    return miniature.$('.nsfw-warning').isDisplayed()
  }

  async expectVideoNSFWTooltip (name: string, summary?: string) {
    const miniature = await this.getVideoMiniature(name)

    const warning = await miniature.$('.nsfw-warning')
    await warning.waitForDisplayed()

    expect(await warning.getAttribute('aria-label')).toEqual(summary)
  }

  private async getVideoMiniature (name: string) {
    const videoName = $('.video-name=' + name)
    await videoName.waitForDisplayed()

    return findParentElement(videoName, async el => await el.getTagName() === 'my-video-miniature')
  }

  async clickOnVideo (videoName: string) {
    const video = async () => {
      const videos = await $$('.videos .video-miniature .video-name').filter(async e => {
        const t = await e.getText()

        return t === videoName
      })

      return videos[0]
    }

    await browser.waitUntil(async () => {
      const elem = await video()

      return elem?.isClickable()
    })
    ;(await video()).click()

    await browser.waitUntil(async () => (await browser.getUrl()).includes('/w/'))
  }

  async clickOnFirstVideo () {
    const video = () => $('.videos .video-miniature .video-thumbnail')
    const videoName = () => $('.videos .video-miniature .video-name')

    await video().waitForClickable()

    const textToReturn = await videoName().getText()
    await video().click()

    await browser.waitUntil(async () => (await browser.getUrl()).includes('/w/'))

    return textToReturn
  }

  private waitForList () {
    return $('.videos .video-miniature .video-name').waitForDisplayed()
  }
}
