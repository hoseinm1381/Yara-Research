import { newPaper } from "./types";
export function demoData() {
  const entries = [
    [
      "Attention Is All You Need",
      2017,
      "core",
      0,
      0,
      ["Ashish Vaswani", "Noam Shazeer"],
      "10.48550/arxiv.1706.03762",
    ],
    [
      "BERT: Pre-training of Deep Bidirectional Transformers",
      2018,
      "core",
      430,
      -115,
      ["Jacob Devlin", "Ming-Wei Chang"],
      "10.48550/arxiv.1810.04805",
    ],
    [
      "Language Models are Few-Shot Learners",
      2020,
      "candidate",
      430,
      120,
      ["Tom B. Brown", "Benjamin Mann"],
      "10.48550/arxiv.2005.14165",
    ],
    [
      "Neural Machine Translation by Jointly Learning to Align and Translate",
      2014,
      "read",
      -430,
      -115,
      ["Dzmitry Bahdanau", "Kyunghyun Cho"],
      "10.48550/arxiv.1409.0473",
    ],
    [
      "Sequence to Sequence Learning with Neural Networks",
      2014,
      "archived",
      -430,
      120,
      ["Ilya Sutskever", "Oriol Vinyals"],
      "10.48550/arxiv.1409.3215",
    ],
    [
      "RoBERTa: A Robustly Optimized BERT Pretraining Approach",
      2019,
      "unreviewed",
      860,
      -10,
      ["Yinhan Liu", "Myle Ott"],
      "10.48550/arxiv.1907.11692",
    ],
  ] as const;
  const papers = entries.map(([title, year, status, x, y, authors, doi]) =>
    newPaper({
      title,
      year,
      status,
      x,
      y,
      authors: [...authors],
      doi,
      pinned: status === "core",
      source: "Optional demo · relationships for illustration",
      tags:
        status === "core"
          ? ["Transformers", "Foundations"]
          : ["Language models"],
      journal: "arXiv",
      abstract:
        "Demo record. This optional dataset illustrates a research workflow. Use online discovery to retrieve and verify complete metadata.",
      summary:
        status === "core"
          ? "A starting point for investigating transformer architectures."
          : "",
    }),
  );
  const edges = [
    [1, 0],
    [2, 0],
    [0, 3],
    [0, 4],
    [5, 0],
    [5, 1],
  ];
  return { papers, edges };
}
