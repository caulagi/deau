/**
 * Module dependencies.
 */

var mongoose = require('mongoose')
  , env = process.env.NODE_ENV || 'development'
  , config = require('../../config/config')[env]
  , Meetup = mongoose.model('Meetup')
  , async = require('async')
  , util = require('util')
  , errors = require('../../lib/errors')
  , request = require('request')
  , markdown = require( "markdown" ).markdown
  , _ = require('underscore')

function monthNames() {
  return [ "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul",
    "Aug", "Sep", "Oct", "Nov", "Dec"];
}

/**
 * Load
 */

exports.load = function(req, res, next, id){
  Meetup.load(id, function (err, meetup) {
    if (err) return next(err)
    if (!meetup) return next(new Error('not found'))
    meetup.description_short = meetup.description.slice(0,250)+'...'
    req.meetup = meetup
    next()
  })
}

/**
 * Landing page - ask user for his location
 */

exports.index = function(req, res){
  res.render('meetups/landing', {
    title: "Events around you",
    fallbackCityId: config.fallbackCityId
  })
}

exports.renderMeetups = renderMeetups = function(res, results, options) {
  var meetups = []
    , tags = []

  _.each(results, function(result, index) {
  /*
    meetup = result.obj;
    meetup.distance = result.dis
  */
    meetups.push(result.obj || result)
  })

  _.each(meetups, function(meetup, index) {
    meetup.description = markdown.toHTML(meetup.description.slice(0,250)+'...')
    _.each(meetup.tags.split(','), function (tag, index) {
      tag = tag.trim()
      if (tag && _.indexOf(tags, tag) === -1) {
        tags.push(tag)
      }
    })
  })

  res.render('meetups/index', {
    title: options.title,
    meetups: meetups,
    tags: _.first(tags, 20),
    loc: options.loc,
    fallbackCityId: config.fallbackCityId
  })
}

exports.byLocation = function(req, res, next) {

  req.session['loc'] = { type: 'Point', coordinates: [
    parseFloat(req.query.lon), parseFloat(req.query.lat)
  ]}
  res.redirect("/meetups/upcoming")
}

exports.upcoming = function(req, res, next) {
  var coords = req.session['loc']
    , options = Meetup.searchOptions()

  options["query"] = {endDate: {$gt: new Date()}}
  Meetup.geoNear(coords, options, function(err, results, stats) {
    if (err) {
      console.log(err)
      return res.render('meetups/empty')
    }

    return renderMeetups(res, results, {
      title: "Upcoming events",
      loc: req.session["loc"]
    })
  })
}

exports.recent = function(req, res, next) {
  Meetup.list({}, function(err, results, stats) {
    if (err) {
      console.log(err)
      return res.render('meetups/empty')
    }

    return renderMeetups(res, results, {
      title: "Recently added events",
    })
  })
}

exports.past = function(req, res, next) {
  var coords = req.session['loc']
    , options = Meetup.searchOptions()

  options["query"] = {endDate: {$lt: new Date()}}
  Meetup.geoNear(coords, options, function(err, results, stats) {
    if (err) {
      console.log(err)
      return res.render('meetups/empty')
    }

    return renderMeetups(res, results, {
      title: "Past events",
      loc: req.session["loc"]
    })
  })
}

/**
 * New meetup
 */

exports.new = function(req, res){
  res.render('meetups/new', {
    title: 'New Meetup',
    meetup: new Meetup({})
  })
}

/**
 * Create an meetup
 */

exports.create = function (req, res, next) {
      
  console.log("CREATE MEETUP")
  console.log(req.body)

  var meetup = new Meetup(req.body)
  meetup.user = req.user
  meetup.loc = { type: 'Point', coordinates: [
    parseFloat(req.body.longitude), parseFloat(req.body.latitude)
  ]}

  meetup.save(function (err, doc, count) {
    console.log(err)
    if (!err) {
      req.flash('success', 'Successfully created meetup!')
      return res.redirect('/meetups/'+doc._id)
    }

    return res.render('meetups/new', {
      title: 'New Meetup',
      meetup: meetup,
      errors: errors.format(err.errors || err)
    })
  })
}

/**
 * Edit an meetup
 */

exports.edit = function (req, res) {
  res.render('meetups/edit', {
    title: 'Edit ' + req.meetup.title,
    meetup: req.meetup
  })
}

/**
 * Update meetup
 */

exports.update = function(req, res){
  console.log("UPDATE MEETUP")
  console.log(req.body)

  var meetup = req.meetup
  meetup = _.extend(meetup, req.body)
  meetup.loc = { type: 'Point', coordinates: [
    parseFloat(req.body.longitude), parseFloat(req.body.latitude)
  ]}

  meetup.save(function(err, doc) {
    if (!err) {
      return res.redirect('/meetups/' + meetup._id)
    }

    res.render('meetups/edit', {
      title: 'Edit Meetup',
      meetup: meetup,
      errors: errors.format(err.errors || err)
    })
  })
}

/**
 * Show
 */

exports.show = function(req, res, next){
  var allowEdit = false
    , showAttending = true
    , meetup = req.meetup
    , user = req.user

  if (user && user.id && (meetup.user.id == user.id)) {
    allowEdit = true
  }

  meetup.attending.forEach(function (attendee, index) {
    if (user && user.id && (user.id === attendee.user.id)) {
      showAttending = false
    }
  })

  meetup.description = markdown.toHTML(meetup.description)
  _.each(meetup.comments, function(comment, index) {
    meetup.comments[index].body = markdown.toHTML(comment.body)
  })

  res.render('meetups/show', {
    title: req.meetup.title,
    meetup: req.meetup,
    allowEdit: allowEdit,
    showAttending: showAttending
  })
}

/**
 * Attending
 */

exports.attending = function(req, res) {
  var includeUser = true
    , meetup = req.meetup
  
  if (!req.user) {
    return res.locals.sendJson(res, {
      'status': 'error',
      'message':'You need to be logged in to complete this action'
    })
  }

  _.each(meetup.attending, function(attendee, index) {
    // Weird - toString is required to force string comparison
    if (req.user._id.toString() === attendee.user._id.toString()) {
      includeUser = false
    }
  })

  if (!includeUser) {
    return res.locals.sendJson(res, {
      'status': 'error',
      'message':'Nothing to do!  You are already attending!'
    })
  }

  meetup.attending.push({ user: req.user })
  meetup.save(function (err, doc, count) {
    return res.locals.sendJson(res, {
      'status': 'ok',
      'message':'Successfully marked as attending!'
    })
  })
}

/**
 * Delete the meetup
 */

exports.destroy = function(req, res){
  var meetup = req.meetup
  meetup.remove(function(err){
    req.flash('info', 'Deleted successfully')
    res.redirect('/meetups/upcoming')
  })
}
