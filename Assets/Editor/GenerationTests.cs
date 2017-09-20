using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;

public class GenerationTests
{

    [Test]
    public void RecordMatch_SavesCombatants()
    {
        var gen = new Generation();
        var a = "a";
        var b = "b";
        gen.AddGenome(a);
        gen.AddGenome(b);
        gen.AddGenome("blancmonge");

        gen.RecordMatch(a, b, a, 13, 7, 5);

        var genString = gen.ToString();

        Assert.True(genString.Contains("a;13;1;0;0;b"), "a's line is wrong");
        Assert.True(genString.Contains("b;7;0;0;1;a"), "b's line is wrong");
    }

    //// A UnityTest behaves like a coroutine in PlayMode
    //// and allows you to yield null to skip a frame in EditMode
    //[UnityTest]
    //public IEnumerator TestTestWithEnumeratorPasses()
    //{
    //    // Use the Assert class to test conditions.
    //    // yield to skip a frame
    //    yield return null;
    //}
}
