/* lint.js */
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";
  var GUTTER_ID = "CodeMirror-lint-markers";

  function showTooltip(e, content) {
    var tt = document.createElement("div");
    tt.className = "CodeMirror-lint-tooltip";
    tt.appendChild(content.cloneNode(true));
    document.body.appendChild(tt);

    function position(e) {
      if (!tt.parentNode) return CodeMirror.off(document, "mousemove", position);
      tt.style.top = Math.max(0, e.clientY - tt.offsetHeight - 5) + "px";
      tt.style.left = (e.clientX + 5) + "px";
    }
    CodeMirror.on(document, "mousemove", position);
    position(e);
    if (tt.style.opacity != null) tt.style.opacity = 1;
    return tt;
  }
  function rm(elt) {
    if (elt.parentNode) elt.parentNode.removeChild(elt);
  }
  function hideTooltip(tt) {
    if (!tt.parentNode) return;
    if (tt.style.opacity == null) rm(tt);
    tt.style.opacity = 0;
    setTimeout(function() { rm(tt); }, 600);
  }

  function showTooltipFor(e, content, node) {
    var tooltip = showTooltip(e, content);
    function hide() {
      CodeMirror.off(node, "mouseout", hide);
      if (tooltip) { hideTooltip(tooltip); tooltip = null; }
    }
    var poll = setInterval(function() {
      if (tooltip) for (var n = node;; n = n.parentNode) {
        if (n && n.nodeType == 11) n = n.host;
        if (n == document.body) return;
        if (!n) { hide(); break; }
      }
      if (!tooltip) return clearInterval(poll);
    }, 400);
    CodeMirror.on(node, "mouseout", hide);
  }

  function LintState(cm, options, hasGutter) {
    this.marked = [];
    this.options = options;
    this.timeout = null;
    this.hasGutter = hasGutter;
    this.onMouseOver = function(e) { onMouseOver(cm, e); };
    this.waitingFor = 0
  }

  function parseOptions(_cm, options) {
    if (options instanceof Function) return {getAnnotations: options};
    if (!options || options === true) options = {};
    return options;
  }

  function clearMarks(cm) {
    var state = cm.state.lint;
    if (state.hasGutter) cm.clearGutter(GUTTER_ID);
    for (var i = 0; i < state.marked.length; ++i)
      state.marked[i].clear();
    state.marked.length = 0;
  }

  function makeMarker(labels, severity, multiple, tooltips) {
    var marker = document.createElement("div"), inner = marker;
    marker.className = "CodeMirror-lint-marker-" + severity;
    if (multiple) {
      inner = marker.appendChild(document.createElement("div"));
      inner.className = "CodeMirror-lint-marker-multiple";
    }

    if (tooltips != false) CodeMirror.on(inner, "mouseover", function(e) {
      showTooltipFor(e, labels, inner);
    });

    return marker;
  }

  function getMaxSeverity(a, b) {
    if (a == "error") return a;
    else return b;
  }

  function groupByLine(annotations) {
    var lines = [];
    for (var i = 0; i < annotations.length; ++i) {
      var ann = annotations[i], line = ann.from.line;
      (lines[line] || (lines[line] = [])).push(ann);
    }
    return lines;
  }

  function annotationTooltip(ann) {
    var severity = ann.severity;
    if (!severity) severity = "error";
    var tip = document.createElement("div");
    tip.className = "CodeMirror-lint-message-" + severity;
    if (typeof ann.messageHTML != 'undefined') {
        tip.innerHTML = ann.messageHTML;
    } else {
        tip.appendChild(document.createTextNode(ann.message));
    }
    return tip;
  }

  function lintAsync(cm, getAnnotations, passOptions) {
    var state = cm.state.lint
    var id = ++state.waitingFor
    function abort() {
      id = -1
      cm.off("change", abort)
    }
    cm.on("change", abort)
    getAnnotations(cm.getValue(), function(annotations, arg2) {
      cm.off("change", abort)
      if (state.waitingFor != id) return
      if (arg2 && annotations instanceof CodeMirror) annotations = arg2
      cm.operation(function() {updateLinting(cm, annotations)})
    }, passOptions, cm);
  }

  function startLinting(cm) {
    var state = cm.state.lint, options = state.options;
    /*
     * Passing rules in `options` property prevents JSHint (and other linters) from complaining
     * about unrecognized rules like `onUpdateLinting`, `delay`, `lintOnChange`, etc.
     */
    var passOptions = options.options || options;
    var getAnnotations = options.getAnnotations || cm.getHelper(CodeMirror.Pos(0, 0), "lint");
    if (!getAnnotations) return;
    if (options.async || getAnnotations.async) {
      lintAsync(cm, getAnnotations, passOptions)
    } else {
      var annotations = getAnnotations(cm.getValue(), passOptions, cm);
      if (!annotations) return;
      if (annotations.then) annotations.then(function(issues) {
        cm.operation(function() {updateLinting(cm, issues)})
      });
      else cm.operation(function() {updateLinting(cm, annotations)})
    }
  }

  function updateLinting(cm, annotationsNotSorted) {
    clearMarks(cm);
    var state = cm.state.lint, options = state.options;

    var annotations = groupByLine(annotationsNotSorted);

    for (var line = 0; line < annotations.length; ++line) {
      var anns = annotations[line];
      if (!anns) continue;

      var maxSeverity = null;
      var tipLabel = state.hasGutter && document.createDocumentFragment();

      for (var i = 0; i < anns.length; ++i) {
        var ann = anns[i];
        var severity = ann.severity;
        if (!severity) severity = "error";
        maxSeverity = getMaxSeverity(maxSeverity, severity);

        if (options.formatAnnotation) ann = options.formatAnnotation(ann);
        if (state.hasGutter) tipLabel.appendChild(annotationTooltip(ann));

        if (ann.to) state.marked.push(cm.markText(ann.from, ann.to, {
          className: "CodeMirror-lint-mark-" + severity,
          __annotation: ann
        }));
      }

      if (state.hasGutter)
        cm.setGutterMarker(line, GUTTER_ID, makeMarker(tipLabel, maxSeverity, anns.length > 1,
                                                       state.options.tooltips));
    }
    if (options.onUpdateLinting) options.onUpdateLinting(annotationsNotSorted, annotations, cm);
  }

  function onChange(cm) {
    var state = cm.state.lint;
    if (!state) return;
    clearTimeout(state.timeout);
    state.timeout = setTimeout(function(){startLinting(cm);}, state.options.delay || 500);
  }

  function popupTooltips(annotations, e) {
    var target = e.target || e.srcElement;
    var tooltip = document.createDocumentFragment();
    for (var i = 0; i < annotations.length; i++) {
      var ann = annotations[i];
      tooltip.appendChild(annotationTooltip(ann));
    }
    showTooltipFor(e, tooltip, target);
  }

  function onMouseOver(cm, e) {
    var target = e.target || e.srcElement;
    if (!/\bCodeMirror-lint-mark-/.test(target.className)) return;
    var box = target.getBoundingClientRect(), x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2;
    var spans = cm.findMarksAt(cm.coordsChar({left: x, top: y}, "client"));

    var annotations = [];
    for (var i = 0; i < spans.length; ++i) {
      var ann = spans[i].__annotation;
      if (ann) annotations.push(ann);
    }
    if (annotations.length) popupTooltips(annotations, e);
  }

  CodeMirror.defineOption("lint", false, function(cm, val, old) {
    if (old && old != CodeMirror.Init) {
      clearMarks(cm);
      if (cm.state.lint.options.lintOnChange !== false)
        cm.off("change", onChange);
      CodeMirror.off(cm.getWrapperElement(), "mouseover", cm.state.lint.onMouseOver);
      clearTimeout(cm.state.lint.timeout);
      delete cm.state.lint;
    }

    if (val) {
      var gutters = cm.getOption("gutters"), hasLintGutter = false;
      for (var i = 0; i < gutters.length; ++i) if (gutters[i] == GUTTER_ID) hasLintGutter = true;
      var state = cm.state.lint = new LintState(cm, parseOptions(cm, val), hasLintGutter);
      if (state.options.lintOnChange !== false)
        cm.on("change", onChange);
      if (state.options.tooltips != false && state.options.tooltips != "gutter")
        CodeMirror.on(cm.getWrapperElement(), "mouseover", state.onMouseOver);

      startLinting(cm);
    }
  });

  CodeMirror.defineExtension("performLint", function() {
    if (this.state.lint) startLinting(this);
  });
});
/* html-lint.js */
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

// Depends on htmlhint.js from http://htmlhint.com/js/htmlhint.js

// declare global: HTMLHint

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"), require("htmlhint"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror", "htmlhint"], mod);
  else // Plain browser env
    mod(CodeMirror, window.HTMLHint);
})(function(CodeMirror, HTMLHint) {
  "use strict";

  var defaultRules = {
    "tagname-lowercase": true,
    "attr-lowercase": true,
    "attr-value-double-quotes": true,
    "doctype-first": false,
    "tag-pair": true,
    "spec-char-escape": true,
    "id-unique": true,
    "src-not-empty": true,
    "attr-no-duplication": true
  };

  CodeMirror.registerHelper("lint", "html", function(text, options) {
    var found = [];
    if (HTMLHint && !HTMLHint.verify) {
      if(typeof HTMLHint.default !== 'undefined') {
        HTMLHint = HTMLHint.default;
      } else {
        HTMLHint = HTMLHint.HTMLHint;
      }
    }
    if (!HTMLHint) HTMLHint = window.HTMLHint;
    if (!HTMLHint) {
      if (window.console) {
          window.console.error("Error: HTMLHint not found, not defined on window, or not available through define/require, CodeMirror HTML linting cannot run.");
      }
      return found;
    }
    var messages = HTMLHint.verify(text, options && options.rules || defaultRules);
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      var startLine = message.line - 1, endLine = message.line - 1, startCol = message.col - 1, endCol = message.col;
      found.push({
        from: CodeMirror.Pos(startLine, startCol),
        to: CodeMirror.Pos(endLine, endCol),
        message: message.message,
        severity : message.type
      });
    }
    return found;
  });
});

/* css-lint.js */
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

// Depends on csslint.js from https://github.com/stubbornella/csslint

// declare global: CSSLint

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.registerHelper("lint", "css", function(text, options) {
  var found = [];
  if (!window.CSSLint) {
    if (window.console) {
        window.console.error("Error: window.CSSLint not defined, CodeMirror CSS linting cannot run.");
    }
    return found;
  }
  var results = CSSLint.verify(text, options), messages = results.messages, message = null;
  for ( var i = 0; i < messages.length; i++) {
    message = messages[i];
    var startLine = message.line -1, endLine = message.line -1, startCol = message.col -1, endCol = message.col;
    found.push({
      from: CodeMirror.Pos(startLine, startCol),
      to: CodeMirror.Pos(endLine, endCol),
      message: message.message,
      severity : message.type
    });
  }
  return found;
});

});
/* javascript-lint.js js-lint.js */
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";
  // declare global: JSHINT

  function validator(text, options) {
    if (!window.JSHINT) {
      if (window.console) {
        window.console.error("Error: window.JSHINT not defined, CodeMirror JavaScript linting cannot run.");
      }
      return [];
    }
    if (!options.indent) // JSHint error.character actually is a column index, this fixes underlining on lines using tabs for indentation
      options.indent = 1; // JSHint default value is 4
    JSHINT(text, options, options.globals);
    var errors = JSHINT.data().errors, result = [];
    if (errors) parseErrors(errors, result);
    return result;
  }

  CodeMirror.registerHelper("lint", "javascript", validator);

  function parseErrors(errors, output) {
    for ( var i = 0; i < errors.length; i++) {
      var error = errors[i];
      if (error) {
        if (error.line <= 0) {
          if (window.console) {
            window.console.warn("Cannot display JSHint error (invalid line " + error.line + ")", error);
          }
          continue;
        }

        var start = error.character - 1, end = start + 1;
        if (error.evidence) {
          var index = error.evidence.substring(start).search(/.\b/);
          if (index > -1) {
            end += index;
          }
        }

        // Convert to format expected by validation service
        var hint = {
          message: error.reason,
          severity: error.code ? (error.code.startsWith('W') ? "warning" : "error") : "error",
          from: CodeMirror.Pos(error.line - 1, start),
          to: CodeMirror.Pos(error.line - 1, end)
        };

        output.push(hint);
      }
    }
  }
});

/* json-lint.js */
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

// Depends on jsonlint.js from https://github.com/zaach/jsonlint

// declare global: jsonlint

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.registerHelper("lint", "json", function(text) {
  var found = [];
  if (!window.jsonlint) {
    if (window.console) {
      window.console.error("Error: window.jsonlint not defined, CodeMirror JSON linting cannot run.");
    }
    return found;
  }
  // for jsonlint's web dist jsonlint is exported as an object with a single property parser, of which parseError
  // is a subproperty
  var jsonlint = window.jsonlint.parser || window.jsonlint
  jsonlint.parseError = function(str, hash) {
    var loc = hash.loc;
    found.push({from: CodeMirror.Pos(loc.first_line - 1, loc.first_column),
                to: CodeMirror.Pos(loc.last_line - 1, loc.last_column),
                message: str});
  };
  try { jsonlint.parse(text); }
  catch(e) {}
  return found;
});

});

/* coffeescript-lint.js */
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

// Depends on coffeelint.js from http://www.coffeelint.org/js/coffeelint.js

// declare global: coffeelint

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.registerHelper("lint", "coffeescript", function(text) {
  var found = [];
  if (!window.coffeelint) {
    if (window.console) {
      window.console.error("Error: window.coffeelint not defined, CodeMirror CoffeeScript linting cannot run.");
    }
    return found;
  }
  var parseError = function(err) {
    var loc = err.lineNumber;
    found.push({from: CodeMirror.Pos(loc-1, 0),
                to: CodeMirror.Pos(loc, 0),
                severity: err.level,
                message: err.message});
  };
  try {
    var res = coffeelint.lint(text);
    for(var i = 0; i < res.length; i++) {
      parseError(res[i]);
    }
  } catch(e) {
    found.push({from: CodeMirror.Pos(e.location.first_line, 0),
                to: CodeMirror.Pos(e.location.last_line, e.location.last_column),
                severity: 'error',
                message: e.message});
  }
  return found;
});

});
/* yaml-lint.js */
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

// Depends on js-yaml.js from https://github.com/nodeca/js-yaml

// declare global: jsyaml

CodeMirror.registerHelper("lint", "yaml", function(text) {
  var found = [];
  if (!window.jsyaml) {
    if (window.console) {
      window.console.error("Error: window.jsyaml not defined, CodeMirror YAML linting cannot run.");
    }
    return found;
  }
  try { jsyaml.loadAll(text); }
  catch(e) {
      var loc = e.mark,
          // js-yaml YAMLException doesn't always provide an accurate lineno
          // e.g., when there are multiple yaml docs
          // ---
          // ---
          // foo:bar
          from = loc ? CodeMirror.Pos(loc.line, loc.column) : CodeMirror.Pos(0, 0),
          to = from;
      found.push({ from: from, to: to, message: e.message });
  }
  return found;
});

});
