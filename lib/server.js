ReactiveTable = {};

ReactiveTable.publish = function (name, collectionOrFunction, selectorOrFunction, settings) {
    Meteor.publish("reactive-table-" + name, function (publicationId, filters, fields, options, rowsPerPage) {
      check(publicationId, String);
      check(filters, [Match.OneOf(String, Object)]);
      check(fields, [[String]]);
      check(options, {skip: Match.Integer, limit: Match.Integer, sort: Object});
      check(rowsPerPage, Match.Integer);

      var collection;
      var selector;

      if (_.isFunction(collectionOrFunction)) {
        collection = collectionOrFunction.call(this);
      } else {
        collection = collectionOrFunction;
      }

      if (!(collection instanceof Mongo.Collection)) {
        console.log("ReactiveTable.publish: no collection to publish");
        return [];
      }

      if (_.isFunction(selectorOrFunction)) {
        selector = selectorOrFunction.call(this);
      } else {
        selector = selectorOrFunction;
      }
      var self = this;
      var filterQuery = _.extend(getFilterQuery(filters, fields, settings), selector);
      if (settings && settings.fields) {
        options.fields = settings.fields;
      }

      // Currently expecting settings like this in ReactiveTable.publish:
      // {sum: ['amount']});
      // Will later change to something like:
      // {
      //   aggregate: {
      //     fieldName: 'sum',
      //     otherField: function (i,m) { return i*2+m; }
      //   }
      // }
      var sums = {};
      if (settings && settings.sum) {
        sums = getAggregates();
      }

      var cursor = collection.find(filterQuery, options);
      var aggregateCursor = collection.find(filterQuery);
      var count = cursor.count();

      var getRow = function (row, index) {
        return _.extend({
          "reactive-table-id": publicationId,
          "reactive-table-sort": index
        }, row);
      };

      var getRows = function () {
        return _.map(cursor.fetch(), getRow);
      };
      var rows = {};
      _.each(getRows(), function (row) {
        rows[row._id] = row;
      });

      var getAggregates = function () {
        var docs = aggregateCursor.fetch();
        return settings.sum.forEach(function(field){
          sums[field] = _(docs)
            .pluck(field)
            .reduce(function(i,m){return i+m;});
        });
      };

      var updateRows = function () {
        var newRows = getRows();
        _.each(newRows, function (row, index) {
          var oldRow = rows[row._id];
          if (oldRow) {
            if (!_.isEqual(oldRow, row)) {
              self.changed("reactive-table-rows-" + publicationId, row._id, row);
              rows[row._id] = row;
            }
          } else {
            self.added("reactive-table-rows-" + publicationId, row._id, row);
            rows[row._id] = row;
          }
        });
      };

      var updateAggregates = function () {
        // TODO: This doens't work at all
        // self.changed("reactive-table-aggregates-" + publicationId, );
      };

      self.added("reactive-table-counts", publicationId, {count: count});
      _.each(rows, function (row) {
        self.added("reactive-table-rows-" + publicationId, row._id, row);
      });
      _.each(sums, function(value, field){
        console.log(field,":",value);
        self.added("reactive-table-aggregates-" + publicationId, field, value);
      });

      var initializing = true;

      var handle = cursor.observeChanges({
        added: function (id, fields) {
          if (!initializing) {
            self.changed("reactive-table-counts", publicationId, {count: cursor.count()});
            updateRows();
          }
        },

        removed: function (id, fields) {
          self.changed("reactive-table-counts", publicationId, {count: cursor.count()});
          self.removed("reactive-table-rows-" + publicationId, id);
          delete rows[id];
          updateRows();
        },

        changed: function (id, fields) {
          updateRows();
        }

      });

      var aggregateHandle = aggregateCursor.observeChanges({
        added: function (id, fields) {
            updateAggregates();
        }
        removed: function (id, fields) {
            updateAggregates();
        }
        changed: function (id, fields) {
            updateAggregates();
        }
      });

      initializing = false;

      self.ready();

      self.onStop(function () {
        handle.stop();
      });
    });
};
