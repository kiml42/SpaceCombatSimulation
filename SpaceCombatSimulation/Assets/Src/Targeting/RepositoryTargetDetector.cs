using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections.Generic;
using System.Linq;

namespace Assets.Src.Targeting
{
    public class RepositoryTargetDetector : ITargetDetector
    {
        private readonly IKnowsEnemyTags _enemyTagKnower;

        public RepositoryTargetDetector(IKnowsEnemyTags enemyTagKnower)
        {
            _enemyTagKnower = enemyTagKnower;
        }

        public IEnumerable<PotentialTarget> DetectTargets(bool includeNavigationTarets = false)
        {
            return TargetRepository.ListTargetsForTags(_enemyTagKnower.KnownEnemyTags, includeNavigationTarets).Select(t => new PotentialTarget(t));
        }
    }
}
