using Assets.Src.Evolution;
using NUnit.Framework;

namespace Assets.Editor.Evolution
{
    public class MatchConfigTests
    {

        [Test]
        public void RandomLocationAlwaysGivesRadiusBetweenMinAndMax()
        {
            for(var i = 0; i < 2000; i++)
            {
                var result = MatchConfig.RandomLocation(2, 1);

                Assert.LessOrEqual(result.magnitude, 2);
                Assert.GreaterOrEqual(result.magnitude, 1);
            }
        }
    }
}
