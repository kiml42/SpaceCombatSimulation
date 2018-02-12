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
    public void PickWinners_PicksWithAReasonableDistribution()
    {
        var all = new List<int>();
        var maxes = new List<int>();
        var mins = new List<int>();

        var runs = 10000;
        var count = 50;

        for(int j = 0; j< runs; j++)
        {
            var gen = new GenerationTargetShooting();

            var genomes = new List<string>();

            for(int i = 0; i < count; i++)
            {
                var score = i - (count / 2);
                gen.AddGenome(score.ToString());

                gen.RecordMatch(new GenomeWrapper(score.ToString()), score, true, true, 1);
            }

            var winners = gen.PickWinners(20);
            var ints = winners.Select(g => int.Parse(g));
            all.AddRange(ints);

            maxes.Add(ints.Max());
            mins.Add(ints.Min());
            //Debug.Log(string.Join(",", winners.ToArray()) + " max: " + ints.Max() + " min: " + ints.Min());
        }
        Debug.Log("max max: " + maxes.Max() + ", min max: " + maxes.Min());
        Debug.Log("max min: " + mins.Max() + ", min min: " + mins.Min());

        var groups = all.GroupBy(i => i);

        foreach(var group in groups.OrderByDescending(g => g.Key))
        {
            Debug.Log(group.Key.ToString().PadRight(5) + 
                (" (" + group.Count().ToString() + ")").PadRight(6) + 
                "".PadRight(group.Count() * 80/runs, '|'));
        }
    }
}
