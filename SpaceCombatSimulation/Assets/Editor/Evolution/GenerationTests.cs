using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Evolution;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System;

namespace Assets.Editor.Evolution
{
    public class GenerationTests
    {
        private string _badGenerationCSVPath = Application.streamingAssetsPath + "/../../Test/TestDB/BadGeneration.csv";
        #region GetCompetitors
        [Test]
        public void GetCompetitors_SelectsThoseWithNoMatchesFirst()
        {
            var count = 10;
            var individuals = new List<Individual> {
                new Individual("0abc1"){MatchesPlayed = 0},
                new Individual("0abc2"){MatchesPlayed = 0},
                new Individual("0abc3"){MatchesPlayed = 0},
                new Individual("0abc4"){MatchesPlayed = 0},
                new Individual("0abc5"){MatchesPlayed = 0},

                new Individual("1abc1"){MatchesPlayed = 1, PreviousCombatantsString = "1abc2"},
                new Individual("1abc2"){MatchesPlayed = 1, PreviousCombatantsString = "1abc1"},
                new Individual("1abc3"){MatchesPlayed = 1, PreviousCombatantsString = "1abc4"},
                new Individual("1abc4"){MatchesPlayed = 1, PreviousCombatantsString = "1abc3"},
                new Individual("1abc5"){MatchesPlayed = 1, PreviousCombatantsString = "1abc6"},

                new Individual("1abc6"){MatchesPlayed = 1, PreviousCombatantsString = "1abc5"},
                new Individual("1abc7"){MatchesPlayed = 1, PreviousCombatantsString = "1abc8"},
                new Individual("1abc8"){MatchesPlayed = 1, PreviousCombatantsString = "1abc7"},
                new Individual("1abc9"){MatchesPlayed = 1, PreviousCombatantsString = "1abca"},
                new Individual("1abca"){MatchesPlayed = 1, PreviousCombatantsString = "1abc9"},

                new Individual("1abcb"){MatchesPlayed = 1, PreviousCombatantsString = "1abcc"},
                new Individual("1abcc"){MatchesPlayed = 1, PreviousCombatantsString = "1abcb"},
                new Individual("1abcd"){MatchesPlayed = 1, PreviousCombatantsString = "1abce"},
                new Individual("1abce"){MatchesPlayed = 1, PreviousCombatantsString = "1abcd"},
                new Individual("1abcf"){MatchesPlayed = 1, PreviousCombatantsString = "1abcg"},

                new Individual("1abcg"){MatchesPlayed = 1, PreviousCombatantsString = "1abcf"},
                new Individual("1abch"){MatchesPlayed = 1, PreviousCombatantsString = "1abci"},
                new Individual("1abci"){MatchesPlayed = 1, PreviousCombatantsString = "1abch"},
                new Individual("1abcj"){MatchesPlayed = 1, PreviousCombatantsString = "1abck"},
                new Individual("1abck"){MatchesPlayed = 1, PreviousCombatantsString = "1abcj"}
            };
            var generation = new Generation(individuals);

            var competitors = generation.PickCompetitors(count);

            Assert.AreEqual(count, competitors.Count);

            Assert.Contains("0abc1", competitors);
            Assert.Contains("0abc2", competitors);
            Assert.Contains("0abc3", competitors);
            Assert.Contains("0abc4", competitors);
            Assert.Contains("0abc5", competitors);
        }

        [Test]
        public void GetCompetitors_SelectsThoseWithNoMatchesFirst_fromFile()
        {
            var count = 10;
            var csv = File.ReadAllLines(_badGenerationCSVPath);

            var individuals = new List<Individual>();

            for (var i = 1; i< csv.Length; i++)
            {
                individuals.Add(FromCsvLine(csv[i]));
            }

            var generation = new Generation(individuals);

            var competitors = generation.PickCompetitors(count);

            Assert.AreEqual(count, competitors.Count);

            Assert.Contains("00006", competitors);
            Assert.Contains("00008", competitors);
            Assert.Contains("00012", competitors);
            Assert.Contains("00024", competitors);
        }

        private Individual FromCsvLine(string line)
        {
            var parts = line.Split('|');
            return new Individual(parts[2])
            {
                MatchesPlayed = int.Parse(parts[14]),
                PreviousCombatantsString = parts[19]
            };
        }
        #endregion

        #region PickWinnersTests
        [Test]
        public void Pickwinners_pickswithareasonabledistribution_50_23()
        {
            var count = 50;
            var winnerscount = 23;

            var all = Testpickwinnersdistribution(count, winnerscount);

            Assert.Less(Min(all), 0);
            Assert.Contains(3, all);
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_20_7()
        {
            var count = 20;
            var winnerscount = 7;

            var all = Testpickwinnersdistribution(count, winnerscount);

            Assert.Less(Min(all), 0);
            Assert.Contains(3, all);
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_50_25()
        {
            var count = 50;
            var winnerscount = 25;

            var all = Testpickwinnersdistribution(count, winnerscount);

            Assert.Less(Min(all), 0);
            Assert.Contains(3, all);
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_20_1()
        {
            var count = 20;
            var winnerscount = 1;

            Testpickwinnersdistribution(count, winnerscount);
            //no assertion here because it won't nessersarily come up with a negative.
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_20_10()
        {
            var count = 20;
            var winnerscount = 10;

            var all = Testpickwinnersdistribution(count, winnerscount);

            Assert.Less(Min(all), 0);
            Assert.Contains(3, all);
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_20_5()
        {
            var count = 20;
            var winnerscount = 5;

            var all = Testpickwinnersdistribution(count, winnerscount);

            Assert.Less(Min(all), 0);
            Assert.Contains(3, all);
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_50_23_morerandom()
        {
            var count = 50;
            var winnerscount = 23;

            var all = Testpickwinnersdistribution_MoreRandom(count, winnerscount);

            Assert.Less(all.Min(), 0);
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_20_7_morerandom()
        {
            var count = 20;
            var winnerscount = 7;

            var all = Testpickwinnersdistribution_MoreRandom(count, winnerscount);

            Assert.Less(all.Min(), 0);
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_50_25_morerandom()
        {
            var count = 50;
            var winnerscount = 25;

            var all = Testpickwinnersdistribution_MoreRandom(count, winnerscount);

            Assert.Less(all.Min(), 0);
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_20_1_morerandom()
        {
            var count = 20;
            var winnerscount = 1;

            Testpickwinnersdistribution_MoreRandom(count, winnerscount);
            //no assertion here because it won't nessersarily come up with a negative.
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_20_10_morerandom()
        {
            var count = 20;
            var winnerscount = 10;

            var all = Testpickwinnersdistribution_MoreRandom(count, winnerscount);

            Assert.Less(all.Min(), 0);
        }

        [Test]
        public void Pickwinners_pickswithareasonabledistribution_20_5_morerandom()
        {
            var count = 20;
            var winnerscount = 5;

            var all = Testpickwinnersdistribution_MoreRandom(count, winnerscount);

            Assert.Less(all.Min(), 0);
        }

        private List<int> Testpickwinnersdistribution(int generationSize, int winnersCount, int runs = 1000)
        {
            Debug.Log(runs + "runs, " + generationSize + " individuals, " + winnersCount + " winners");
            var all = new List<int>();
            var maxes = new List<int>();
            var mins = new List<int>();

            for (int j = 0; j < runs; j++)
            {
                var gen = new Generation();

                for (int i = 0; i < generationSize; i++)
                {
                    var score = i - (generationSize / 2);
                    gen.AddGenome(score.ToString());

                    gen.RecordMatch(new GenomeWrapper(score.ToString()), score, true, true, 1, null, false);
                }

                var winners = gen.PickWinners(winnersCount);

                var ints = winners.Select(g => int.Parse(g)).ToList();

                all.AddRange(ints);
                maxes.Add(ints.Max());
                mins.Add(Min(ints));
            }
            Debug.Log("max max: " + maxes.Max() + ", min max: " + Min(maxes));
            Debug.Log("max min: " + mins.Max() + ", min min: " + Min(mins));
            Debug.Log("max all: " + all.Max() + ", min all: " + Min(all));

            //Debug.Log("all:  " + string.Join(",",  all.OrderBy(x => x).Select(x => x.ToString()).Take(30).ToArray()));
            //Debug.Log("mins: " + string.Join(",", mins.OrderBy(x => x).Select(x => x.ToString()).Take(30).ToArray()));

            var groups = all.GroupBy(i => i);

            foreach (var group in groups.OrderByDescending(g => g.Key))
            {
                Debug.Log((group.Key.ToString()).PadRight(5) +
                    (" (" + group.Count().ToString() + ")").PadRight(8) +
                    "".PadRight(group.Count() * 80 / runs, '|'));
            }

            return all;
        }

        private List<float> Testpickwinnersdistribution_MoreRandom(int generationSize, int winnersCount, int runs = 1000)
        {
            Debug.Log(runs + "runs, " + generationSize + " individuals, " + winnersCount + " winners");
            var all = new List<float>();
            var maxes = new List<float>();
            var mins = new List<float>();

            var gen = new Generation();

            var random = new System.Random();

            for (int i = 0; i < generationSize; i++)
            {
                var score = (float)(0.5 - random.NextDouble()) * 1000;

                gen.AddGenome(score.ToString());

                gen.RecordMatch(new GenomeWrapper(score.ToString()), score, true, true, 1, null, false);
            }

            for (int j = 0; j < runs; j++)
            {

                var winners = gen.PickWinners(winnersCount);

                var ints = winners.Select(g => float.Parse(g)).ToList();

                all.AddRange(ints);
                maxes.Add(ints.Max());
                mins.Add(ints.Min());
            }
            Debug.Log("max max: " + maxes.Max() + ", min max: " + maxes.Min());
            Debug.Log("max min: " + mins.Max() + ", min min: " + mins.Min());
            Debug.Log("max all: " + all.Max() + ", min all: " + all.Min());

            //Debug.Log("all:  " + string.Join(",",  all.OrderBy(x => x).Select(x => x.ToString()).Take(30).ToArray()));
            //Debug.Log("mins: " + string.Join(",", mins.OrderBy(x => x).Select(x => x.ToString()).Take(30).ToArray()));

            var groups = all.GroupBy(i => i);

            foreach (var group in groups.OrderByDescending(g => g.Key))
            {
                Debug.Log((group.Key.ToString()).PadRight(10) +
                    (" (" + group.Count().ToString() + ")").PadRight(8) +
                    "".PadRight(group.Count() * 80 / runs, '|'));
            }

            return all;
        }

        private int Min(List<int> ints)
        {
            return ints.Min();
        }
        #endregion
    }
}
