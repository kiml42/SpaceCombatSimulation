using Assets.Src.Controllers;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using UnityEngine;

public class SpawnProjectile : AbstractDeactivatableController
{
    private IKnowsCurrentTarget _targetChoosingMechanism;
    private IKnowsEnemyTags _enemyTagKnower;
    private ITarget _thisTarget;
    public bool TagChildren = false;
    public Rigidbody Projectile;
    public Transform Emitter;
    private Rigidbody _spawner;
    
    public float RandomStartTime = 30;
    public float MinStartTime = 30;

    public int BurstCount = 1;
    private int _projectilesThisBurst = 0;
    public float BurstInterval = 1;
    
    public Vector3 Velocity = new Vector3(0, 0, 10);
    public float RandomSpeed = 1;

    private float _reload = 0;
    public float LoadTime = 200;

    private ColourSetter _colerer;

    // Use this for initialization
    void Start()
    {
        _colerer = GetComponent<ColourSetter>();
        _reload = Random.value * RandomStartTime + MinStartTime;
        Emitter = Emitter != null ? Emitter : transform;
        _targetChoosingMechanism = GetComponent<IKnowsCurrentTarget>();
        _enemyTagKnower = GetComponent<IKnowsEnemyTags>();
        _spawner = GetComponent<Rigidbody>();
        _thisTarget = GetComponent<ITarget>();
    }

    // Update is called once per frame
    void FixedUpdate()
    {
        if (_active)
            if (_reload <= 0 && ShouldShoot())
            {
                var projectile = Instantiate(Projectile, Emitter.position, Emitter.rotation);

                //Debug.Log("Velocity " + Velocity);
                Vector3 velocity = Emitter.TransformVector(Velocity);
                //velocity = Velocity.magnitude * Emitter.transform.forward;
                //Debug.Log("velocity " + velocity);

                if (_spawner != null)
                {
                    velocity += _spawner.velocity;
                }

                velocity += RandomSpeed * UnityEngine.Random.insideUnitSphere;

                projectile.velocity = velocity;

                var tagKnower = projectile.GetComponent<IKnowsEnemyTags>();
                if(tagKnower != null && _targetChoosingMechanism != null)
                {
                    tagKnower.KnownEnemyTags = _enemyTagKnower.KnownEnemyTags;
                }
                
                if (TagChildren)
                {
                    var target = projectile.GetComponent<ITarget>();
                    target.Team = _thisTarget.Team;
                }

                if (_colerer != null)
                {
                    //Debug.Log("has renderer");
                    projectile.transform.SetColor(_colerer.Colour);
                }

                if (GetConfigFromGenome && !string.IsNullOrEmpty(RocketGenome))
                {
                    var typeKnower = projectile.GetComponent<IModuleTypeKnower>();
                    if(typeKnower != null)
                    {
                        typeKnower.Configure(new GenomeWrapper(RocketGenome));
                    }
                }

                _projectilesThisBurst++;
                var stilBursting = _projectilesThisBurst < BurstCount;
                _projectilesThisBurst = stilBursting ? _projectilesThisBurst : 0;

                _reload = stilBursting ? BurstInterval :LoadTime;
            }
            else
            {
                _reload-=Time.fixedDeltaTime;
            }
    }

    private bool ShouldShoot()
    {
        if (_targetChoosingMechanism != null)
        {
            return _targetChoosingMechanism.CurrentTarget != null;
        }
        return true;
    }
    
    private string RocketGenome;

    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        RocketGenome = genomeWrapper.Genome.Substring(genomeWrapper.GetGeneAsInt() ?? 0);
        Velocity *= genomeWrapper.GetScaledNumber(1);
        RandomStartTime = genomeWrapper.GetScaledNumber(RandomStartTime * 2);
        MinStartTime = genomeWrapper.GetScaledNumber(MinStartTime * 2);
        RandomSpeed = genomeWrapper.GetScaledNumber(RandomSpeed * 2, RandomSpeed, 0.1f);
        LoadTime = genomeWrapper.GetScaledNumber(LoadTime * 2, LoadTime, 0.1f);
        return genomeWrapper;
    }
}
