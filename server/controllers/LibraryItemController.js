const Logger = require('../Logger')
const Author = require('../objects/entities/Author')
const Series = require('../objects/entities/Series')
const { reqSupportsWebp } = require('../utils/index')

class LibraryItemController {
  constructor() { }

  findOne(req, res) {
    if (req.query.expanded == 1) return res.json(req.libraryItem.toJSONExpanded())
    res.json(req.libraryItem)
  }

  async update(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn('User attempted to update without permission', req.user)
      return res.sendStatus(403)
    }
    var libraryItem = req.libraryItem
    // Item has cover and update is removing cover so purge it from cache
    if (libraryItem.media.coverPath && req.body.media && (req.body.media.coverPath === '' || req.body.media.coverPath === null)) {
      await this.cacheManager.purgeCoverCache(libraryItem.id)
    }

    var hasUpdates = libraryItem.update(req.body)
    if (hasUpdates) {
      Logger.debug(`[LibraryItemController] Updated now saving`)
      await this.db.updateLibraryItem(libraryItem)
      this.emitter('item_updated', libraryItem.toJSONExpanded())
    }
    res.json(libraryItem.toJSON())
  }

  //
  // PATCH: will create new authors & series if in payload
  //
  async updateMedia(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn('User attempted to update without permission', req.user)
      return res.sendStatus(403)
    }

    var libraryItem = req.libraryItem
    var mediaPayload = req.body
    // Item has cover and update is removing cover so purge it from cache
    if (libraryItem.media.coverPath && (mediaPayload.coverPath === '' || mediaPayload.coverPath === null)) {
      await this.cacheManager.purgeCoverCache(libraryItem.id)
    }

    if (mediaPayload.metadata) {
      var mediaMetadata = mediaPayload.metadata

      // Create new authors if in payload
      if (mediaMetadata.authors && mediaMetadata.authors.length) {
        // TODO: validate authors
        var newAuthors = []
        for (let i = 0; i < mediaMetadata.authors.length; i++) {
          if (mediaMetadata.authors[i].id.startsWith('new')) {
            var newAuthor = new Author()
            newAuthor.setData(mediaMetadata.authors[i])
            Logger.debug(`[LibraryItemController] Created new author "${newAuthor.name}"`)
            newAuthors.push(newAuthor)
            // Update ID in original payload
            mediaMetadata.authors[i].id = newAuthor.id
          }
        }
        if (newAuthors.length) {
          await this.db.insertEntities('author', newAuthors)
          this.emitter('authors_added', newAuthors)
        }
      }

      // Create new series if in payload
      if (mediaMetadata.series && mediaMetadata.series.length) {
        // TODO: validate series
        var newSeries = []
        for (let i = 0; i < mediaMetadata.series.length; i++) {
          if (mediaMetadata.series[i].id.startsWith('new')) {
            var newSeriesItem = new Series()
            newSeriesItem.setData(mediaMetadata.series[i])
            Logger.debug(`[LibraryItemController] Created new series "${newSeriesItem.name}"`)
            newSeries.push(newSeriesItem)
            // Update ID in original payload
            mediaMetadata.series[i].id = newSeriesItem.id
          }
        }
        if (newSeries.length) {
          await this.db.insertEntities('series', newSeries)
          this.emitter('authors_added', newSeries)
        }
      }
    }

    var hasUpdates = libraryItem.media.update(mediaPayload)
    if (hasUpdates) {
      Logger.debug(`[LibraryItemController] Updated library item media ${libraryItem.media.metadata.title}`)
      await this.db.updateLibraryItem(libraryItem)
      this.emitter('item_updated', libraryItem.toJSONExpanded())
    }
    res.json(libraryItem)
  }

  // GET api/items/:id/cover
  async getCover(req, res) {
    let { query: { width, height, format }, libraryItem } = req

    const options = {
      format: format || (reqSupportsWebp(req) ? 'webp' : 'jpeg'),
      height: height ? parseInt(height) : null,
      width: width ? parseInt(width) : null
    }
    return this.cacheManager.handleCoverCache(res, libraryItem, options)
  }

  middleware(req, res, next) {
    var item = this.db.libraryItems.find(li => li.id === req.params.id)
    if (!item || !item.media || !item.media.coverPath) return res.sendStatus(404)

    // Check user can access this audiobooks library
    if (!req.user.checkCanAccessLibrary(item.libraryId)) {
      return res.sendStatus(403)
    }

    req.libraryItem = item
    next()
  }
}
module.exports = new LibraryItemController()