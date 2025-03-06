import { CommonModule, NgClass, NgIf } from '@angular/common'
import { Component, inject, OnDestroy, OnInit, viewChild } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import {
  AuthService,
  AuthUser,
  ConfirmService,
  LocalStorageService,
  Notifier,
  PeerTubeRouterService,
  RestPagination,
  RestTable,
  ServerService
} from '@app/core'
import { HeaderService } from '@app/header/header.service'
import { formatICU } from '@app/helpers'
import { AutoColspanDirective } from '@app/shared/shared-main/common/auto-colspan.directive'
import { Video } from '@app/shared/shared-main/video/video.model'
import { VideoService } from '@app/shared/shared-main/video/video.service'
import { VideoPlaylistService } from '@app/shared/shared-video-playlist/video-playlist.service'
import { ChannelToggleComponent } from '@app/shared/standalone-channels/channel-toggle.component'
import { NgbDropdownModule, NgbTooltip } from '@ng-bootstrap/ng-bootstrap'
import { arrayify } from '@peertube/peertube-core-utils'
import {
  UserRight,
  VideoChannel,
  VideoExistInPlaylist,
  VideoPrivacy,
  VideoPrivacyType,
  VideosExistInPlaylists
} from '@peertube/peertube-models'
import { logger } from '@root-helpers/logger'
import uniqBy from 'lodash-es/uniqBy'
import { SharedModule, SortMeta } from 'primeng/api'
import { TableModule } from 'primeng/table'
import { finalize } from 'rxjs/operators'
import { SelectOptionsItem } from 'src/types'
import { AdvancedInputFilterComponent } from '../../shared/shared-forms/advanced-input-filter.component'
import { PeertubeCheckboxComponent } from '../../shared/shared-forms/peertube-checkbox.component'
import { SelectCheckboxComponent } from '../../shared/shared-forms/select/select-checkbox.component'
import { ActionDropdownComponent, DropdownAction } from '../../shared/shared-main/buttons/action-dropdown.component'
import { ButtonComponent } from '../../shared/shared-main/buttons/button.component'
import { PTDatePipe } from '../../shared/shared-main/common/date.pipe'
import { NumberFormatterPipe } from '../../shared/shared-main/common/number-formatter.pipe'
import { VideoCellComponent } from '../../shared/shared-tables/video-cell.component'
import {
  VideoActionsDisplayType,
  VideoActionsDropdownComponent
} from '../../shared/shared-video-miniature/video-actions-dropdown.component'
import { VideoPrivacyBadgeComponent } from '../../shared/shared-video/video-privacy-badge.component'
import { VideoStateBadgeComponent } from '../../shared/shared-video/video-state-badge.component'
import { VideoChangeOwnershipComponent } from './modals/video-change-ownership.component'

type Column = 'duration' | 'name' | 'privacy' | 'sensitive' | 'playlists' | 'insights' | 'published' | 'state'
type CommonFilter = 'live' | 'vod' | 'private' | 'internal' | 'unlisted' | 'password-protected' | 'public'

@Component({
  selector: 'my-videos',
  templateUrl: './my-videos.component.html',
  styleUrls: [ './my-videos.component.scss' ],
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    NgClass,
    SharedModule,
    NgIf,
    ActionDropdownComponent,
    AdvancedInputFilterComponent,
    ButtonComponent,
    NgbTooltip,
    VideoActionsDropdownComponent,
    VideoCellComponent,
    RouterLink,
    NumberFormatterPipe,
    VideoChangeOwnershipComponent,
    VideoPrivacyBadgeComponent,
    VideoStateBadgeComponent,
    NgbDropdownModule,
    PeertubeCheckboxComponent,
    ChannelToggleComponent,
    AutoColspanDirective,
    SelectCheckboxComponent,
    PTDatePipe
  ]
})
export class MyVideosComponent extends RestTable<Video> implements OnInit, OnDestroy {
  protected route = inject(ActivatedRoute)
  protected router = inject(Router)
  private confirmService = inject(ConfirmService)
  private auth = inject(AuthService)
  private notifier = inject(Notifier)
  private videoService = inject(VideoService)
  private playlistService = inject(VideoPlaylistService)
  private server = inject(ServerService)
  private peertubeLocalStorage = inject(LocalStorageService)
  private peertubeRouter = inject(PeerTubeRouterService)
  private headerService = inject(HeaderService)

  private static readonly LS_SELECTED_COLUMNS_KEY = 'user-my-videos-selected-columns'

  readonly videoChangeOwnershipModal = viewChild<VideoChangeOwnershipComponent>('videoChangeOwnershipModal')

  videos: Video[] = []

  totalRecords = 0
  sort: SortMeta = { field: 'publishedAt', order: -1 }
  pagination: RestPagination = { count: this.rowsPerPage, start: 0 }

  videosContainedInPlaylists: VideosExistInPlaylists = {}

  bulkActions: DropdownAction<Video[]>[][] = []

  videoActionsOptions: VideoActionsDisplayType = {
    playlist: true,
    download: true,
    update: false,
    blacklist: false,
    delete: true,
    report: false,
    duplicate: false,
    mute: false,
    liveInfo: true,
    removeFiles: false,
    transcoding: false,
    studio: true,
    stats: true
  }

  moreVideoActions: DropdownAction<{ video: Video }>[][] = []
  loading = true

  user: AuthUser
  channels: (VideoChannel & { selected: boolean })[] = []

  filterItems: SelectOptionsItem<CommonFilter>[] = []
  selectedFilterItems: CommonFilter[] = []

  columns: { id: Column, label: string, selected: boolean }[] = []

  get serverConfig () {
    return this.server.getHTMLConfig()
  }

  ngOnInit () {
    this.initialize()

    this.headerService.setSearchHidden(true)

    this.user = this.auth.getUser()

    this.columns = [
      { id: 'duration', label: $localize`Duration`, selected: true },
      { id: 'name', label: $localize`Name`, selected: true },
      { id: 'privacy', label: $localize`Privacy`, selected: true },
      { id: 'sensitive', label: $localize`Sensitive`, selected: true },
      { id: 'playlists', label: $localize`Playlists`, selected: true },
      { id: 'insights', label: $localize`Insights`, selected: true },
      { id: 'published', label: $localize`Published`, selected: true },
      { id: 'state', label: $localize`State`, selected: true }
    ]

    this.filterItems = [
      {
        id: 'live',
        label: $localize`Lives`
      },
      {
        id: 'vod',
        label: $localize`VOD`
      },
      {
        id: 'public',
        label: $localize`Public videos`
      },
      {
        id: 'internal',
        label: $localize`Internal videos`
      },
      {
        id: 'unlisted',
        label: $localize`Unlisted videos`
      },
      {
        id: 'password-protected',
        label: $localize`Password protected videos`
      },
      {
        id: 'private',
        label: $localize`Private videos`
      }
    ]

    this.parseQueryParams()
    this.buildActions()
    this.loadSelectedColumns()
  }

  ngOnDestroy () {
    this.headerService.setSearchHidden(false)
  }

  private parseQueryParams () {
    const queryParams = this.route.snapshot.queryParams as {
      channelNameOneOf?: string[]
      privacyOneOf?: string[]
      isLive: string
    }

    {
      const enabledChannels = queryParams.channelNameOneOf
        ? new Set(arrayify(queryParams.channelNameOneOf))
        : new Set<string>()

      this.user = this.auth.getUser()
      this.channels = this.user.videoChannels.map(c => ({
        ...c,

        selected: enabledChannels.has(c.name)
      }))
    }

    {
      if (queryParams.isLive === 'true') this.selectedFilterItems.push('live')
      if (queryParams.isLive === 'false') this.selectedFilterItems.push('vod')

      const enabledPrivacies = queryParams.privacyOneOf
        ? new Set(arrayify(queryParams.privacyOneOf).map(t => parseInt(t) as VideoPrivacyType))
        : new Set<VideoPrivacyType>()

      if (enabledPrivacies.has(VideoPrivacy.PUBLIC)) this.selectedFilterItems.push('public')
      if (enabledPrivacies.has(VideoPrivacy.INTERNAL)) this.selectedFilterItems.push('internal')
      if (enabledPrivacies.has(VideoPrivacy.UNLISTED)) this.selectedFilterItems.push('unlisted')
      if (enabledPrivacies.has(VideoPrivacy.PASSWORD_PROTECTED)) this.selectedFilterItems.push('password-protected')
      if (enabledPrivacies.has(VideoPrivacy.PRIVATE)) this.selectedFilterItems.push('private')
    }
  }

  getIdentifier () {
    return 'MyVideosComponent'
  }

  // ---------------------------------------------------------------------------

  isSelected (id: Column) {
    return this.columns.some(c => c.id === id && c.selected)
  }

  getColumn (id: Column) {
    return this.columns.find(c => c.id === id)
  }

  private loadSelectedColumns () {
    const enabledString = this.peertubeLocalStorage.getItem(MyVideosComponent.LS_SELECTED_COLUMNS_KEY)

    if (!enabledString) return
    try {
      const enabled = JSON.parse(enabledString)

      for (const column of this.columns) {
        column.selected = enabled.includes(column.id)
      }
    } catch (err) {
      logger.error('Cannot load selected columns.', err)
    }
  }

  saveSelectedColumns () {
    const enabled = this.columns.filter(c => c.selected).map(c => c.id)

    this.peertubeLocalStorage.setItem(MyVideosComponent.LS_SELECTED_COLUMNS_KEY, JSON.stringify(enabled))
  }

  onFilter () {
    const channelNameOneOf = this.channels.filter(c => c.selected).map(c => c.name)

    const newParams = {
      ...this.route.snapshot.queryParams,
      ...this.buildCommonVideoFilters(),

      channelNameOneOf
    }

    this.peertubeRouter.silentNavigate([ '.' ], newParams, this.route)
    this.resetAndReload()
  }

  private buildCommonVideoFilters () {
    const selectedFilterSet = new Set(this.selectedFilterItems)

    let isLive: boolean
    if (selectedFilterSet.has('live') && !selectedFilterSet.has('vod')) {
      isLive = true
    } else if (!selectedFilterSet.has('live') && selectedFilterSet.has('vod')) {
      isLive = false
    }

    const privacyOneOf: VideoPrivacyType[] = []
    if (selectedFilterSet.has('public')) privacyOneOf.push(VideoPrivacy.PUBLIC)
    if (selectedFilterSet.has('internal')) privacyOneOf.push(VideoPrivacy.INTERNAL)
    if (selectedFilterSet.has('unlisted')) privacyOneOf.push(VideoPrivacy.UNLISTED)
    if (selectedFilterSet.has('password-protected')) privacyOneOf.push(VideoPrivacy.PASSWORD_PROTECTED)
    if (selectedFilterSet.has('private')) privacyOneOf.push(VideoPrivacy.PRIVATE)

    return {
      isLive,
      privacyOneOf
    }
  }

  // ---------------------------------------------------------------------------

  protected reloadDataInternal () {
    this.loading = true

    const channelNameOneOf = this.channels.filter(c => c.selected).map(c => c.name)

    return this.videoService.listMyVideos({
      restPagination: this.pagination,
      sort: this.sort,
      search: this.search,

      channelNameOneOf: channelNameOneOf.length !== 0
        ? channelNameOneOf
        : undefined,

      ...this.buildCommonVideoFilters()
    }).pipe(finalize(() => this.loading = false))
      .subscribe({
        next: resultList => {
          this.videos = resultList.data
          this.totalRecords = resultList.total

          this.fetchVideosContainedInPlaylists(resultList.data)
        },

        error: err => this.notifier.error(err.message)
      })
  }

  private fetchVideosContainedInPlaylists (videos: Video[]) {
    this.playlistService.doVideosExistInPlaylist(videos.map(v => v.id))
      .subscribe(result => {
        this.videosContainedInPlaylists = Object.keys(result).reduce((acc, videoId) => ({
          ...acc,
          [videoId]: uniqBy(result[+videoId], (p: VideoExistInPlaylist) => p.playlistId)
        }), this.videosContainedInPlaylists)
      })
  }

  async removeVideos (videos: Video[]) {
    const message = formatICU(
      $localize`Are you sure you want to delete {count, plural, =1 {this video} other {these {count} videos}}?`,
      { count: videos.length }
    )

    const res = await this.confirmService.confirm(message, $localize`Delete`)
    if (res === false) return

    this.videoService.removeVideo(videos.map(v => v.id))
      .subscribe({
        next: () => {
          this.notifier.success(
            formatICU(
              $localize`Deleted {count, plural, =1 {1 video} other {{count} videos}}.`,
              { count: videos.length }
            )
          )

          this.reloadData()
        },

        error: err => this.notifier.error(err.message)
      })
  }

  changeOwnership (video: Video) {
    this.videoChangeOwnershipModal().show(video)
  }

  private buildActions () {
    this.moreVideoActions = [
      [
        {
          label: $localize`Change ownership`,
          handler: ({ video }) => this.changeOwnership(video),
          iconName: 'ownership-change'
        }
      ]
    ]

    this.bulkActions = [
      [
        {
          label: $localize`Delete`,
          handler: videos => this.removeVideos(videos),
          isDisplayed: () => this.user.hasRight(UserRight.REMOVE_ANY_VIDEO),
          iconName: 'delete'
        }
      ]
    ]
  }
}
