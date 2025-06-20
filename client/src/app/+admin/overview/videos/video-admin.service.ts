import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { RestExtractor, RestPagination, RestService } from '@app/core'
import { AdvancedInputFilter } from '@app/shared/shared-forms/advanced-input-filter.component'
import { Video } from '@app/shared/shared-main/video/video.model'
import { VideoListParams, VideoService } from '@app/shared/shared-main/video/video.service'
import { getAllPrivacies, omit } from '@peertube/peertube-core-utils'
import { ResultList, VideoInclude, VideoPrivacy } from '@peertube/peertube-models'
import { Observable } from 'rxjs'
import { catchError, switchMap } from 'rxjs/operators'

@Injectable()
export class VideoAdminService {
  private videoService = inject(VideoService)
  private authHttp = inject(HttpClient)
  private restExtractor = inject(RestExtractor)
  private restService = inject(RestService)

  getAdminVideos (
    options: VideoListParams & { pagination: RestPagination, search?: string }
  ): Observable<ResultList<Video>> {
    const { pagination, search } = options

    let params = new HttpParams()
    params = this.videoService.buildVideoListParams({ params, ...omit(options, [ 'search', 'pagination' ]) })

    params = params.set('start', pagination.start.toString())
      .set('count', pagination.count.toString())

    params = this.buildAdminParamsFromSearch(search, params)

    return this.authHttp
      .get<ResultList<Video>>(VideoService.BASE_VIDEO_URL, { params })
      .pipe(
        switchMap(res => this.videoService.extractVideos(res)),
        catchError(err => this.restExtractor.handleError(err))
      )
  }

  buildAdminInputFilter (): AdvancedInputFilter[] {
    return [
      {
        title: $localize`Moderation`,
        children: [
          {
            value: 'nsfw:true',
            label: $localize`Sensitive videos`
          }
        ]
      },

      {
        title: $localize`Video type`,
        children: [
          {
            value: 'isLive:false',
            label: $localize`VOD`
          },
          {
            value: 'isLive:true',
            label: $localize`Live`
          }
        ]
      },

      {
        title: $localize`Video files`,
        children: [
          {
            value: 'webVideos:true isLocal:true',
            label: $localize`With Web Videos`
          },
          {
            value: 'webVideos:false isLocal:true',
            label: $localize`Without Web Videos`
          },
          {
            value: 'hls:true isLocal:true',
            label: $localize`With HLS`
          },
          {
            value: 'hls:false isLocal:true',
            label: $localize`Without HLS`
          }
        ]
      },

      {
        title: $localize`Videos scope`,
        children: [
          {
            value: 'isLocal:false',
            label: $localize`Remote videos`
          },
          {
            value: 'isLocal:true',
            label: $localize`Local videos`
          }
        ]
      },

      {
        title: $localize`Exclude`,
        children: [
          {
            value: 'excludeMuted',
            label: $localize`Exclude muted accounts`
          },
          {
            value: 'excludePublic',
            label: $localize`Exclude public videos`
          }
        ]
      }
    ]
  }

  private buildAdminParamsFromSearch (search: string, params: HttpParams) {
    let include = VideoInclude.BLACKLISTED |
      VideoInclude.BLOCKED_OWNER |
      VideoInclude.NOT_PUBLISHED_STATE |
      VideoInclude.FILES |
      VideoInclude.SOURCE |
      VideoInclude.AUTOMATIC_TAGS

    let privacyOneOf = getAllPrivacies()

    if (!search) return this.restService.addObjectParams(params, { include, privacyOneOf })

    const filters = this.restService.parseQueryStringFilter(search, {
      isLocal: {
        prefix: 'isLocal:',
        isBoolean: true
      },
      hasHLSFiles: {
        prefix: 'hls:',
        isBoolean: true
      },
      hasWebVideoFiles: {
        prefix: 'webVideos:',
        isBoolean: true
      },
      isLive: {
        prefix: 'isLive:',
        isBoolean: true
      },
      excludeMuted: {
        prefix: 'excludeMuted',
        handler: () => true
      },
      excludePublic: {
        prefix: 'excludePublic',
        handler: () => true
      },
      autoTagOneOf: {
        prefix: 'autoTag:',
        multiple: true
      },
      nsfw: {
        prefix: 'nsfw:',
        isBoolean: true
      }
    })

    if (filters.excludeMuted) {
      include &= ~VideoInclude.BLOCKED_OWNER

      filters.excludeMuted = undefined
    }

    if (filters.excludePublic) {
      privacyOneOf = [ VideoPrivacy.PRIVATE, VideoPrivacy.UNLISTED, VideoPrivacy.INTERNAL, VideoPrivacy.PASSWORD_PROTECTED ]

      filters.excludePublic = undefined
    }

    return this.restService.addObjectParams(params, { ...filters, include, privacyOneOf })
  }
}
