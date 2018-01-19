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

        [Test]
        public void JumpTest()
        {
            var genome = new GenomeWrapper("053456789", 2);

            genome.Jump();  //jumps to index 05

            var g1 = genome.GetGene();  //reads index 05 & 06

            genome.JumpBack();  //jumps back to index 2.

            var g2 = genome.GetGene();

            Assert.AreEqual("67", g1);
            Assert.AreEqual("34", g2);
        }

        [Test]
        public void JumpTest_tooManyJumpBacks()
        {
            var genome = new GenomeWrapper("053456789", 2);

            genome.Jump();  //jumps to index 05

            var g1 = genome.GetGene();  //reads index 05 & 06

            genome.JumpBack();  //jumps back to index 2.
            genome.JumpBack();  //jumps back faile, left at index 2.

            var g2 = genome.GetGene();

            Assert.AreEqual("67", g1);
            Assert.AreEqual("34", g2);
        }
    }
}
