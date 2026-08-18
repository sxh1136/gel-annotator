export type LadderPreset = {
  key: string;
  label: string;
  sizes: number[]; // top -> bottom
};

export type LadderPresetGroup = {
  group: string;
  presets: LadderPreset[];
};

export const LADDER_PRESET_GROUPS: LadderPresetGroup[] = [
  {
    group: "Custom",
    presets: [{ key: "custom", label: "Custom (manual)", sizes: [] }],
  },

{
    group: "Dongsheng Biotech Co., Ltd.",
    presets: [
      {
        key: "DS2000",
        label: "DS2000 DNA Marker",
        sizes: [2000,1000,750,500,250,100],
      },
    ],
  },
  
  {
    group: "Invitrogen™ (Thermo Fisher Scientific Inc.)",
    presets: [
      {
        key: "invitrogen-100bp",
        label: "Invitrogen™ 100 bp DNA Ladder",
        sizes: [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
      },
      {
        key: "invitrogen-1kb-plus",
        label: "Invitrogen™ 1 kb Plus DNA Ladder",
        sizes: [12000, 10000, 8000, 6000, 5000, 4000, 3000, 2000, 1650, 1000, 850, 650, 500, 400, 300, 200, 100],
      },
    ],
  },

  {
    group: "Thermo Scientific™ (Thermo Fisher Scientific Inc.)",
    presets: [
      {
        key: "thermo-generuler-100bp",
        label: "GeneRuler™ 100 bp DNA Ladder",
        sizes: [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
      },
      {
        key: "thermo-generuler-100bp-plus",
        label: "GeneRuler™ 100 bp Plus DNA Ladder",
        sizes: [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 75, 50],
      },
      {
        key: "thermo-generuler-50bp",
        label: "GeneRuler™ 50 bp DNA Ladder",
        sizes: [1000, 900, 800, 700, 600, 500, 450, 400, 350, 300, 250, 200, 150, 100, 50],
      },
      {
        key: "thermo-generuler-1kb",
        label: "GeneRuler™ 1 kb DNA Ladder",
        sizes: [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500],
      },
      {
        key: "thermo-trackit-100bp",
        label: "TrackIt™ 100 bp DNA Ladder",
        sizes: [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
      },
      {
        key: "thermo-trackit-1kb-plus",
        label: "TrackIt™ 1 kb Plus DNA Ladder",
        sizes: [12000, 10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 700, 500, 400, 300, 200, 100],
      },
    ],
  },

  {
    group: "New England Biolabs, Inc.",
    presets: [
      {
        key: "neb-quickload-100bp",
        label: "Quick-Load® 100 bp DNA Ladder",
        sizes: [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
      },
      {
        key: "neb-quickload-purple-100bp",
        label: "Quick-Load® Purple 100 bp DNA Ladder",
        sizes: [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
      },
      {
        key: "neb-quickload-1kb",
        label: "Quick-Load® 1 kb DNA Ladder",
        sizes: [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500],
      },
      {
        key: "neb-quickload-purple-1kb-plus",
        label: "Quick-Load® Purple 1 kb Plus DNA Ladder",
        sizes: [12000, 10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2500, 2000, 1500, 1000, 700, 500, 400, 300, 200, 100],
      },
      {
        key: "neb-2-log",
        label: "2-Log DNA Ladder",
        sizes: [10000, 5000, 3000, 2000, 1500, 1000, 700, 500, 400, 300, 200, 100],
      },
    ],
  },
];