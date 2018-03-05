using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Evolution;
using System.Collections.Generic;
using System.Linq;

public class GenerationTests
{
    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_50_23()
    {
        var count = 50;
        var winnersCount = 23;

        var all = TestPickWinnersDistribution(count, winnersCount);

        Assert.Less(Min(all), 0);
        Assert.Contains(3, all);
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_20_7()
    {
        var count = 20;
        var winnersCount = 7;

        var all = TestPickWinnersDistribution(count, winnersCount);

        Assert.Less(Min(all), 0);
        Assert.Contains(3, all);
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_50_25()
    {
        var count = 50;
        var winnersCount = 25;

        var all = TestPickWinnersDistribution(count, winnersCount);

        Assert.Less(Min(all), 0);
        Assert.Contains(3, all);
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_20_1()
    {
        var count = 20;
        var winnersCount = 1;

        TestPickWinnersDistribution(count, winnersCount);
        //no assertion here because it won't nessersarily come up with a negative.
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_20_10()
    {
        var count = 20;
        var winnersCount = 10;

        var all = TestPickWinnersDistribution(count, winnersCount);

        Assert.Less(Min(all), 0);
        Assert.Contains(3, all);
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_20_5()
    {
        var count = 20;
        var winnersCount = 5;

        var all = TestPickWinnersDistribution(count, winnersCount);

        Assert.Less(Min(all), 0);
        Assert.Contains(3, all);
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_50_23_moreRandom()
    {
        var count = 50;
        var winnersCount = 23;

        var all = TestPickWinnersDistribution_MoreRandom(count, winnersCount);

        Assert.Less(all.Min(), 0);
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_20_7_moreRandom()
    {
        var count = 20;
        var winnersCount = 7;

        var all = TestPickWinnersDistribution_MoreRandom(count, winnersCount);

        Assert.Less(all.Min(), 0);
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_50_25_moreRandom()
    {
        var count = 50;
        var winnersCount = 25;

        var all = TestPickWinnersDistribution_MoreRandom(count, winnersCount);

        Assert.Less(all.Min(), 0);
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_20_1_moreRandom()
    {
        var count = 20;
        var winnersCount = 1;

        TestPickWinnersDistribution_MoreRandom(count, winnersCount);
        //no assertion here because it won't nessersarily come up with a negative.
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_20_10_moreRandom()
    {
        var count = 20;
        var winnersCount = 10;

        var all = TestPickWinnersDistribution_MoreRandom(count, winnersCount);

        Assert.Less(all.Min(), 0);
    }

    [Test]
    public void PickWinners_PicksWithAReasonableDistribution_20_5_moreRandom()
    {
        var count = 20;
        var winnersCount = 5;

        var all = TestPickWinnersDistribution_MoreRandom(count, winnersCount);

        Assert.Less(all.Min(), 0);
    }

    private List<int> TestPickWinnersDistribution(int generationSize, int winnersCount, int runs = 1000)
    {
        Debug.Log(runs + "runs, " + generationSize + " individuals, " + winnersCount + " winners");
        var all = new List<int>();
        var maxes = new List<int>();
        var mins = new List<int>();
        
        for (int j = 0; j < runs; j++)
        {
            var gen = new GenerationDrone();

            for (int i = 0; i < generationSize; i++)
            {
                var score = i - (generationSize / 2);
                gen.AddGenome(score.ToString());

                gen.RecordMatch(new GenomeWrapper(score.ToString()), score, true, true, 1);
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

    private List<float> TestPickWinnersDistribution_MoreRandom(int generationSize, int winnersCount, int runs = 1000)
    {
        Debug.Log(runs + "runs, " + generationSize + " individuals, " + winnersCount + " winners");
        var all = new List<float>();
        var maxes = new List<float>();
        var mins = new List<float>();

        var gen = new GenerationDrone();

        var random = new System.Random();

        for (int i = 0; i < generationSize; i++)
        {
            var score = (float)(0.5 - random.NextDouble()) * 1000;

            gen.AddGenome(score.ToString());

            gen.RecordMatch(new GenomeWrapper(score.ToString()), score, true, true, 1);
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
}
