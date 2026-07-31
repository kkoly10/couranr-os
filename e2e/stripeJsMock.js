/**
 * Stands in for https://js.stripe.com/v3 in the browser.
 *
 * `loadStripe` injects a script tag at that URL; the suite intercepts the
 * request with `page.route` and serves this instead. It implements only the
 * surface @stripe/react-stripe-js actually uses, so the REAL Elements provider
 * and the REAL PaymentElement component run against it — what is faked is
 * Stripe, not our integration.
 *
 * `confirmPayment` tells the local Stripe API double to move the intent to
 * `requires_capture`, which is what a real manual-capture confirmation does.
 * It returns `{}` — success — and NOTHING else: the browser never learns and
 * never asserts that the payment is authorized. Only the server does, by
 * retrieving the intent.
 */
(function () {
  function makeElement(type) {
    var handlers = {};
    return {
      mount: function (target) {
        var node = typeof target === "string" ? document.querySelector(target) : target;
        if (node) {
          node.setAttribute("data-stripe-element", type);
          node.innerHTML =
            '<div data-testid="mock-payment-element">' +
            '<input aria-label="Card number" data-mock-card />' +
            "</div>";
        }
        if (handlers.ready) setTimeout(function () { handlers.ready({}); }, 0);
      },
      unmount: function () {},
      destroy: function () {},
      update: function () {},
      on: function (evt, cb) { handlers[evt] = cb; return this; },
      off: function () { return this; },
      focus: function () {},
      blur: function () {},
    };
  }

  function makeElements(options) {
    var created = {};
    return {
      create: function (type) { created[type] = makeElement(type); return created[type]; },
      getElement: function (type) { return created[type] || null; },
      update: function () {},
      submit: function () { return Promise.resolve({}); },
      fetchUpdates: function () { return Promise.resolve({}); },
      _clientSecret: options && options.clientSecret,
    };
  }

  window.__couranrStripeCalls = [];

  window.Stripe = function (publishableKey) {
    window.__couranrStripeCalls.push({ fn: "Stripe", publishableKey: publishableKey });
    return {
      _apiKey: publishableKey,
      elements: function (options) {
        var cs = options && options.clientSecret;
        window.__couranrStripeCalls.push({ fn: "elements", clientSecret: cs });
        /*
         * The PaymentIntent id is derivable from the client secret Stripe
         * itself formats as `<intent id>_secret_<random>`. Reading it here
         * means the suite never has to intercept an API response to learn it
         * — and never has to call page.evaluate from inside a route handler,
         * which deadlocks against the request the page is waiting on.
         */
        if (cs && cs.indexOf("_secret_") > -1) {
          window.__couranrIntentId = String(cs).split("_secret_")[0];
        }
        return makeElements(options);
      },
      confirmPayment: function (opts) {
        window.__couranrStripeCalls.push({
          fn: "confirmPayment",
          redirect: opts && opts.redirect,
          // Records whether anything money-shaped was passed from the browser.
          amount: opts && opts.amount,
          currency: opts && opts.currency,
        });

        // Injected failure, so the decline path is drivable.
        if (window.__couranrStripeFailNext) {
          window.__couranrStripeFailNext = false;
          return Promise.resolve({
            error: { type: "card_error", message: "Your card was declined." },
          });
        }

        var id = window.__couranrIntentId;
        if (!id) return Promise.resolve({});
        return fetch(window.__couranrDoubleBase + "/__control/confirm/" + id, {
          method: "POST",
        })
          .then(function () { return {}; })
          .catch(function () { return {}; });
      },
      retrievePaymentIntent: function () {
        return Promise.resolve({ paymentIntent: { status: "requires_capture" } });
      },
    };
  };
})();
