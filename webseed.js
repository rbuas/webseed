module.exports = WebSeed;

var gulp = require("gulp"); 
var less = require("gulp-less");
var moment = require("moment");
var minifyCSS = require("gulp-minify-css");
var uglifyjs = require("gulp-uglify");
var concat = require("gulp-concat");
var path = require("path");
var rename = require("gulp-rename");
var gutil = require( "gulp-util" );
var ftpvinyl = require( "vinyl-ftp" );
var jeditor = require("gulp-json-editor");
var exec = require("child_process").exec;
var argv = require("yargs").argv;
var jsext = require("jsext");

function WebSeed (options) {
    var self = this;
    self.options = Object.assign({}, self.DEFAULTOPTIONS, options);
    self.actions = self.options.actions;
    self.version = jsext.loadJsonFile(self.options.versionfile) || {version:""};

    self.process = {};
    initialize(self);
}

WebSeed.prototype.DEFAULTOPTIONS = {
    name : "",
    versionfile : "version.json",
    dateformat : "YYYYMMDDHHmmss",
    actions : [],
    build : [],
    watch : []
};

WebSeed.prototype.man = function () {
    var self = this;
    if(!self.actions)
        return console.log("WEBSEED : no actions configureated to this seed");

    console.log("---------------------------------------");
    console.log("WEBSEED ACTIONS : ");
    console.log("---------------------------------------");
    var actionsKeys = Object.keys(self.options.actions);
    actionsKeys.forEach(function(actionname) {
        var aconfig = self.actions[actionname];
        if(!aconfig || !aconfig.action) return;

        var tab = (actionname.length > 7) ? "\t\t: " : "\t\t\t: ";
        var help = aconfig.help || "";
        console.log(actionname + tab, help);
    });
    console.log("---------------------------------------");
}

WebSeed.prototype.build = function () {
    var self = this;
    if(!self.options.build) return;

    self.options.build.forEach(function(buildaction) {
        var aconfig = self.actions[buildaction];
        if(!aconfig || !aconfig.action) return;

        aconfig.action(self);
    });
}

WebSeed.prototype.watch = function () {
    var self = this;
    if(!self.options.watch) return;

    self.options.watch.forEach(function(watchaction) {
        var aconfig = self.actions[watchaction];
        if(!aconfig || !aconfig.action) return;

        aconfig.action(self);
    });
}

WebSeed.prototype.saveJson = function(filename, data) {
    gulp.src("./" + filename)
    .pipe(jeditor(data))
    .pipe(gulp.dest("./" + filename));
}

WebSeed.prototype.buildJS = function (config) {
    var self = this;
    config = getBundleConfig(self, config);
    if (!config || !config.process || !config.inputfiles || !config.outputfile || !config.ouputdir)
        return console.log("WEBSEED::ERROR: missing buildJS function parameters ");

    if (!startProcess(self, config.process)) return;

    return gulp.src(config.inputfiles, config.options)
    .pipe(plumber())
    .pipe(concat(config.outputfile))
    .pipe(gulp.dest(config.ouputdir))
    .pipe(uglifyjs({ mangle: false }))
    .pipe(rename({ suffix: ".min" }))
    .pipe(gulp.dest(config.ouputdir))
    .on("end", function () {
        endProcess(self, config.process);
    });
}

WebSeed.prototype.watchJS = function(config) {
    var self = this;
    config = getBundleConfig(self, config);
    if(!config || !config.inputfiles)
        return console.log("WEBSEED::ERROR: missing watchJS function parameters");

    return gulp.watch(config.inputfiles, function(event) {
        console.log("WEBSEED::WATCH: " + event.path + ' was ' + event.type + '...');
        return self.buildJS(config); 
    });
}

WebSeed.prototype.buildLess = function(config) {
    var self = this;
    config = getBundleConfig(self, config);
    if(!config || !config.process || !config.inputfiles)
        return console.log("WEBSEED::ERROR: missing buildLess function parameters : ");

    if(!startProcess(self, config.process)) return;

    return gulp.src(config.inputfiles)
    .pipe(less().on('error', function(err) {
        console.log("WEBSEED::ERROR:", err);
        this.emit('end');
    }))
    .pipe(minifyCSS())
    .pipe(gulp.dest(config.outputdir))
    .on('error', function(err) {
        console.log(err);
    })
    .on('end', function() {
        endProcess(self, config.process);
    });
}

WebSeed.prototype.watchLess = function(process, lessfiles, inputfiles, outputdir) {
    var self = this;
    config = getBundleConfig(self, config);
    if(!config || !config.process || !config.watchfiles)
        return console.log("WEBSEED::ERROR: missing watchLess function parameters");

    return gulp.watch(config.watchfiles, function(event) {
        console.log("WEBSEED: " + event.path + " was " + event.type + "...");
        return self.buildLess(config);
    });
}

WebSeed.prototype.connectdir = function(subprojects) {
    var self = this;
    if(!subprojects || !startProcess(self, "connectsb")) return;

    for(var link in subprojects) {
        if(!subprojects.hasOwnProperty(link))
            continue;

        var sb = subprojects[link];
        var command = "@mklink /D " + link + " " + sb;
        exec(command, function (err, stdout, stderr) {
            console.log(stdout);
            console.log(stderr);
        });
        
    }
    endProcess(self, "connectsb");
}

WebSeed.prototype.deploystatic = function(ftpconfig, files, destination) {
    var self = this;
    if(!subprojects || !startProcess(self, "deploystatic")) return;

    ftpconfig.log = gutil.log;
    ftpconfig.parallel = 20;

    var env = argv && argv.env || "production";

    var conn = ftpvinyl.create(ftpconfig);
    var params = { base: ".", buffer: false, debug: true };
    return gulp.src(files, params )
    //.pipe( conn.newer( builder.CONFIG.remotepath ) ) 
    .pipe( conn.dest( destination ) )
    .on("end", function() {
        endProcess(self, "deploystatic");
    });
}

// PRIVATE

function initialize (self) {
    console.log("WEBSEED: " + self.options.name + " initialize ...");
    processActions(self);
}

function processActions (self) {
    var actionsKeys = Object.keys(self.actions);
    actionsKeys.forEach(function(actionname) {
        var aconfig = self.actions[actionname];
        if(!aconfig || !aconfig.action) return;

        gulp.task(actionname, function() { return aconfig.action(self); } );
    });
}

function startProcess (self, action) {
    if(self.process[action]) return false;

    var start = moment();
    self.process[action] = start;
    var time = start.format(self.options.dateformat);
    console.log("[" + time + "] WEBSEED::Starting : '" + action + "' ...");
}

function endProcess (self, action) {
    if(!self.process[action]) return false;

    var start = self.process[action];
    self.process[action] = null;
    delete self.process[action];
    
    var time = start.fromNow();

    console.log("[" + time + "] WEBSEED::Finished : '" + action + "' (" + diff + "s)");
}

function getBundleConfig (self, config) {
    if(!config || typeof(config) != "string")
        return config;

    var bundleConfig = self.options.bundles[config];
    if(!bundleConfig) {
        console.log("WEBSEED::ERROR: missing bundle configuration ", config);
        return;
    }
    return Object.assign({process:config}, bundleConfig);
}