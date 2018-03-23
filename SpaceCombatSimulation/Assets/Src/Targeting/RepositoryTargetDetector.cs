using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections.Generic;
using System.Linq;

namespace Assets.Src.Targeting
{
    public class RepositoryTargetDetector : ITargetDetector
    {
        private IKnowsEnemyTags _enemyTagKnower;

        public RepositoryTargetDetector(IKnowsEnemyTags enemyTagKnower)
        {
            _enemyTagKnower = enemyTagKnower;
        }

        public IEnumerable<PotentialTarget> DetectTargets()
        {
            return TargetRepository.ListTargetsForTags(_enemyTagKnower.KnownEnemyTags).Select(t => new PotentialTarget(t));
        }
    }
}
