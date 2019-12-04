using Assets.Src.Evolution;
using NUnit.Framework;
using System.Linq;
using UnityEngine;

namespace Assets.Editor.Evolution
{
    public class MatchConfigTests
    {
        private readonly MatchConfig _config = new MatchConfig
        {
            MinimumLocationRandomisation = 1,
            MaximumLocationRandomisation = 2
        };

        [Test]
        public void RandomLocationAlways_GivesRadiusBetweenMinAndMax()
        {
            for(var i = 0; i < 2000; i++)
            {
                var result = _config.RandomLocation();

                Assert.LessOrEqual(result.magnitude, _config.MaximumLocationRandomisation);
                Assert.GreaterOrEqual(result.magnitude, _config.MinimumLocationRandomisation);
            }
        }

        [Test]
        public void PositionForCompetitor_GiviesGoesAroundArc()
        {
            var config = new MatchConfig
            {
                InitialRange = 100,
                StepForwardProportion = 0.5f
            };

            var numberOfShips = 10;
            var positions = Enumerable.Range(0, numberOfShips * 2);

            var results = positions.Select(p => config.PositionForCompetitor(p, numberOfShips));

            var expectedMagnitudes = new float[]
            {
                config.InitialRange,
                config.InitialRange,
                config.InitialRange,
                config.InitialRange,
                config.InitialRange,
                config.InitialRange,
                config.InitialRange,
                config.InitialRange,
                config.InitialRange,
                config.InitialRange,
                config.InitialRange * config.StepForwardProportion,
                config.InitialRange * config.StepForwardProportion,
                config.InitialRange * config.StepForwardProportion,
                config.InitialRange * config.StepForwardProportion,
                config.InitialRange * config.StepForwardProportion,
                config.InitialRange * config.StepForwardProportion,
                config.InitialRange * config.StepForwardProportion,
                config.InitialRange * config.StepForwardProportion,
                config.InitialRange * config.StepForwardProportion,
                config.InitialRange * config.StepForwardProportion,
            };
            
            var expectedAngles = new float[]
             {
                0,
                36,
                72,
                108,
                144,
                180,
                216,
                252,
                288,
                324,
                0,
                36,
                72,
                108,
                144,
                180,
                216,
                252,
                288,
                324
             };

            var i = 0;
            foreach (var position in results)
            {
                var countOfThisPosition = results.Count(p => p == position);
                Assert.Equals(1, countOfThisPosition);

                Assert.Equals(expectedMagnitudes[i], position.magnitude);

                var angle = Vector3.SignedAngle(Vector3.back, position, Vector3.up);
                Assert.Equals(expectedAngles[i], angle);

                i++;
            }
        }
    }
}
