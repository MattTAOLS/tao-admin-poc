"""On-demand accuracy check of the Claude news check against a small labelled set (design: "Testing and honesty about
what is verified"). It calls the live model, so it costs money and is never run by the tests:

    ANTHROPIC_API_KEY=... python check_eval.py            # NEWS_MODEL picks the model (default claude-haiku-5-5)

Prints one line per case and the share of cases where kept/excluded matched the label. The four Dynamic Capital cases
are paraphrases of the stories from the wave E test run; the rest are invented test stories."""
import os
import sys

import check

DYNAMIC = {"name": "Dynamic Capital", "aliases": [], "industry": "Equipment leasing", "headquarters": "Canada",
           "programs": ["MOVE Trust"], "news_context_terms": [], "news_exclusions": []}
ESSEX = {"name": "Essex Lease Financial Corp.", "aliases": ["Essex Lease Financial"], "industry": "Equipment leasing",
         "headquarters": "Canada", "programs": ["MOVE Trust"], "news_context_terms": [], "news_exclusions": []}

CASES = [
    (DYNAMIC, False, {"title": "Dynamic capital", "publisher": "a private equity magazine",
                      "text": "Private equity firms talk about keeping capital dynamic across a downturn. The column is "
                              "about fund strategy; it names no lender."}),
    (DYNAMIC, False, {"title": "Mexico City's newest market is a dynamic capital of street food", "publisher": "travel",
                      "text": "A food market in Mexico City, described as a dynamic capital of street food."}),
    (DYNAMIC, False, {"title": "A US fintech explains its dynamic capital strategy", "publisher": "markets",
                      "text": "A US consumer fintech describes a dynamic capital strategy for its balance sheet."}),
    (DYNAMIC, False, {"title": "Tirana, Albania's dynamic capital, draws visitors", "publisher": "travel",
                      "text": "Tirana, the capital of Albania, is called a dynamic capital by visitors."}),
    (DYNAMIC, True, {"title": "Dynamic Capital expands its equipment leasing program", "publisher": "trade press",
                     "text": "Dynamic Capital, a Canadian equipment leasing company, said it expanded its program."}),
    (ESSEX, True, {"title": "Essex Lease Financial named in lawsuit over equipment leases", "publisher": "court news",
                   "text": "Essex Lease Financial Corp., a Canadian equipment lessor, was named in a lawsuit."}),
    (ESSEX, False, {"title": "Essex Lease Financing Ltd faces bankruptcy petition", "publisher": "UK press",
                    "text": "Essex Lease Financing Ltd, a UK car leasing broker based in Essex, England, faces a "
                            "bankruptcy petition."}),
]


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set; nothing was run.")
        return 2
    checker = check.ClaudeChecker(model=os.environ.get("NEWS_MODEL") or check.DEFAULT_MODEL,
                                  api_key=os.environ["ANTHROPIC_API_KEY"])
    right = tokens = 0
    for company, expect, story in CASES:
        try:
            v = checker.check(company, story)
        except check.CheckUnavailable as exc:
            print(f"ERROR  {story['title']}: {exc}")
            continue
        ok = v.kept == expect
        right += ok
        tokens += v.input_tokens + v.output_tokens
        print(f"{'ok   ' if ok else 'WRONG'}  expected {'kept' if expect else 'excluded'}, got {v.status} "
              f"({v.confidence:.2f}): {story['title']} | {v.reason}")
    print(f"{right}/{len(CASES)} matched the label; {tokens} tokens; model {checker.model}")
    return 0 if right == len(CASES) else 1


if __name__ == "__main__":
    sys.exit(main())
