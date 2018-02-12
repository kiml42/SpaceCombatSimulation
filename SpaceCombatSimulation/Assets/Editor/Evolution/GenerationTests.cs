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
    public void RecordMatch_SavesCombatants()
    {
        var gen = new Generation1v1();
        var a = "a";
        var b = "b";
        gen.AddGenome(a);
        gen.AddGenome(b);
        gen.AddGenome("blancmonge");

        gen.RecordMatch(new GenomeWrapper(a), new GenomeWrapper(b), a, 13, 7, 5);

        var genString = gen.ToString();

        Assert.True(genString.Contains("a;13;1;0;0;b"), "a's line is wrong");
        Assert.True(genString.Contains("b;7;0;0;1;a"), "b's line is wrong");
    }

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
        var runs = 5000;
        var count = 20;
        var winnersCount = 1;

        TestPickWinnersDistribution(count, winnersCount, runs);
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

    private List<int> TestPickWinnersDistribution(int generationSize, int winnersCount, int runs = 1000)
    {
        Debug.Log(runs + "runs, " + generationSize + " individuals, " + winnersCount + " winners");
        var all = new List<int>();
        var maxes = new List<int>();
        var mins = new List<int>();
        
        for (int j = 0; j < runs; j++)
        {
            var gen = new GenerationTargetShooting();

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

    private int Min(List<int> ints)
    {
        return ints.Min();
    }
}
