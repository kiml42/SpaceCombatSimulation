using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Assets.Src.Evolution;

public class SpawnProjectile : MonoBehaviour, IDeactivatable, IGeneticConfigurable
{
    private IKnowsEnemyTagsAndCurrentTarget _targetChoosingMechanism;
    public bool TagChildren = false;
    public Rigidbody Projectile;
    public Transform Emitter;
    private Rigidbody _spawner;
    
    public float RandomStartTime = 30;
    public float MinStartTime = 30;
    private bool _active = true;

    public int BurstCount = 1;
    private int _projectilesThisBurst = 0;
    public float BurstInterval = 1;
    
    public Vector3 Velocity = new Vector3(0, 0, 10);
    public float RandomSpeed = 1;

    private float _reload = 0;
    public float LoadTime = 200;

    private string InactiveTag = "Untagged";
    private ColourSetter _colerer;

    // Use this for initialization
    void Start()
    {
        _colerer = GetComponent<ColourSetter>();
        _reload = UnityEngine.Random.value * RandomStartTime + MinStartTime;
        Emitter = Emitter ?? transform;
        _targetChoosingMechanism = GetComponent<IKnowsEnemyTagsAndCurrentTarget>();

        _spawner = GetComponent<Rigidbody>();
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
                    velocity = velocity + _spawner.velocity;
                }

                velocity += RandomSpeed * UnityEngine.Random.insideUnitSphere;

                projectile.velocity = velocity;

                var tagKnower = projectile.GetComponent<IKnowsEnemyTags>();
                if(tagKnower != null)
                {
                    tagKnower.EnemyTags = _targetChoosingMechanism.EnemyTags;
                }
                
                if (TagChildren) { projectile.tag = tag; }

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
                        typeKnower.Configure(new GenomeWrapper(RocketGenome, _targetChoosingMechanism.EnemyTags));
                    }
                }

                _projectilesThisBurst++;
                var stilBursting = _projectilesThisBurst < BurstCount;
                _projectilesThisBurst = stilBursting ? _projectilesThisBurst : 0;

                _reload = stilBursting ? BurstInterval :LoadTime;
            }
            else
            {
                _reload-=Time.deltaTime;
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

    public void Deactivate()
    {
        //Debug.Log("Deactivating " + name);
        _active = false;
        tag = InactiveTag;
    }


    public bool GetConfigFromGenome = true;
    private string RocketGenome;

    public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
    {
        if (GetConfigFromGenome)
        {
            RocketGenome = genomeWrapper.Genome.Substring(genomeWrapper.GetGeneAsInt() ?? 0);
        }
        return genomeWrapper;
    }
}
