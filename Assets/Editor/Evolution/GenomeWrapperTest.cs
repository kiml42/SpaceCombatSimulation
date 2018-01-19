using Assets.Src.Evolution;
using NUnit.Framework;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Editor.Evolution
{
    public class GenomeWrapperTest
    {
        [Test]
        public void GenomeWrappsCorrectly()
        {
            var genome = new GenomeWrapper("123");

            var g1 = genome.GetGene();
            var g2 = genome.GetGene();

            Assert.AreEqual("12", g1);
            Assert.AreEqual("31", g2);
        }
    }
}
